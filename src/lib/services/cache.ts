/**
 * Data caching layer for frequently-accessed data.
 * Uses in-memory cache with TTL for server-side rendering.
 * In production, this can be backed by Cloudflare KV or Workers Cache API.
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
 * Get a value from cache, or compute it if missing/expired.
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
  const existing = cache.get(key) as CacheEntry<T> | undefined;

  if (existing && existing.expiresAt > now) {
    return existing.data;
  }

  // Singleflight: deduplicate concurrent fetches for the same key
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) {
    return pending;
  }

  const promise = fetcher()
    .then((data) => {
      cache.set(key, { data, expiresAt: Date.now() + ttlMs });
      evictIfNeeded();
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      // Clear from inflight on error so subsequent callers retry
      // instead of receiving the cached rejected promise forever.
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}

/**
 * Invalidate a specific cache key.
 */
export function invalidateCache(key: string): void {
  cache.delete(key);
}

/**
 * Invalidate all cache keys matching a prefix.
 */
export function invalidateCacheByPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
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
