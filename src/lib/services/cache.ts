/**
 * Two-tier caching layer for frequently-accessed data.
 *
 * Tier 1: In-memory LRU cache (fastest, per-isolate, lost on cold start)
 * Tier 2: Cloudflare Workers Cache API (edge-persistent, shared across requests)
 *
 * Read path:  memory → Workers Cache → fetcher
 * Write path: fetcher result → memory + Workers Cache (parallel)
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/** In-flight fetch deduplication map (singleflight pattern) */
const inflight = new Map<string, Promise<unknown>>();

const DEFAULT_TTL_MS = 60_000; // 60 seconds
const MAX_CACHE_SIZE = 500; // Prevent unbounded memory growth

/** Synthetic URL prefix for Workers Cache API keys (never fetched over the network) */
const EDGE_CACHE_PREFIX = "https://cache.internal/";

/**
 * Return the Cloudflare Workers Cache API handle, or null when running
 * outside the Workers runtime (local dev, tests, Node.js SSR).
 */
function getEdgeCache(): Cache | null {
  try {
    // `caches.default` is the Cloudflare Workers Cache API global.
    // It throws or is undefined in Node / Vitest.
    if (typeof caches !== "undefined" && "default" in caches) {
      return (caches as unknown as { default: Cache }).default;
    }
  } catch {
    /* not in Workers runtime */
  }
  return null;
}

/**
 * Evict the oldest entry when the cache exceeds MAX_CACHE_SIZE.
 * Map preserves insertion order, so the first key is the oldest.
 */
function evictIfNeeded(): void {
  while (cache.size > MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
    else break;
  }
}

/**
 * Try to read a value from the Workers Cache API.
 * Returns `undefined` on miss or when the API is unavailable.
 */
async function edgeCacheGet<T>(key: string): Promise<T | undefined> {
  const edgeCache = getEdgeCache();
  if (!edgeCache) return undefined;

  try {
    const res = await edgeCache.match(new Request(EDGE_CACHE_PREFIX + encodeURIComponent(key)));
    if (!res) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

/**
 * Write a value into the Workers Cache API with a max-age header.
 * Fails silently — edge cache is best-effort.
 */
async function edgeCachePut<T>(key: string, data: T, ttlMs: number): Promise<void> {
  const edgeCache = getEdgeCache();
  if (!edgeCache) return;

  try {
    const ttlSeconds = Math.max(1, Math.round(ttlMs / 1000));
    const url = EDGE_CACHE_PREFIX + encodeURIComponent(key);
    const response = new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${ttlSeconds}`,
      },
    });
    await edgeCache.put(new Request(url), response);
  } catch {
    /* best-effort */
  }
}

/**
 * Delete a key from the Workers Cache API. Fails silently.
 */
async function edgeCacheDelete(key: string): Promise<void> {
  const edgeCache = getEdgeCache();
  if (!edgeCache) return;

  try {
    await edgeCache.delete(new Request(EDGE_CACHE_PREFIX + encodeURIComponent(key)));
  } catch {
    /* best-effort */
  }
}

/**
 * Get a value from cache, or compute it if missing/expired.
 *
 * Read path: in-memory → Workers Cache → fetcher
 * Write path: fetcher result → in-memory + Workers Cache (parallel)
 *
 * The entire edge-cache + fetcher pipeline is wrapped in a single promise
 * that is registered in the inflight map *synchronously* before any await,
 * preserving the singleflight deduplication guarantee.
 *
 * @param key - Cache key
 * @param fetcher - Async function to compute the value if not cached
 * @param ttlMs - Time-to-live in milliseconds (default: 60s)
 * @returns The cached or freshly computed value
 */
export async function cacheable<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  const now = Date.now();

  // Tier 1: in-memory (fastest, synchronous)
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now) {
    return existing.data;
  }

  // Singleflight: deduplicate concurrent fetches for the same key.
  // Must happen synchronously (before any await) so concurrent callers
  // always see the inflight entry.
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) {
    return pending;
  }

  // Wrap edge-cache lookup + fetcher in a single promise registered
  // in the inflight map before the first await.
  const promise = (async (): Promise<T> => {
    // Tier 2: Workers Cache API (edge-persistent)
    const edgeHit = await edgeCacheGet<T>(key);
    if (edgeHit !== undefined) {
      // Promote into in-memory so subsequent reads skip the edge round-trip
      cache.set(key, { data: edgeHit, expiresAt: Date.now() + ttlMs });
      evictIfNeeded();
      return edgeHit;
    }

    // Tier 3: compute via fetcher
    const data = await fetcher();
    cache.set(key, { data, expiresAt: Date.now() + ttlMs });
    evictIfNeeded();

    // Write-through to Workers Cache (non-blocking, best-effort)
    edgeCachePut(key, data, ttlMs).catch(() => {});

    return data;
  })()
    .then((data) => {
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      // Clear from inflight on error so subsequent callers retry
      // instead of receiving the cached rejected promise forever.
      inflight.delete(key);
      throw err;
    });

  // Register synchronously — no await has happened yet
  inflight.set(key, promise);
  return promise;
}

/**
 * Invalidate a specific cache key (both in-memory and edge).
 */
export function invalidateCache(key: string): void {
  cache.delete(key);
  edgeCacheDelete(key).catch(() => {});
}

/**
 * Invalidate all cache keys matching a prefix (in-memory + edge).
 * Note: Workers Cache API does not support prefix deletion, so we
 * iterate known in-memory keys and delete their edge counterparts.
 */
export function invalidateCacheByPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      edgeCacheDelete(key).catch(() => {});
    }
  }
}

/**
 * Clear the entire cache.
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}
