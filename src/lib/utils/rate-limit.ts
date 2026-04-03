/**
 * Generic rate-limit check against the Cloudflare rate-limiter worker.
 *
 * Fails open — if the worker is unreachable the request proceeds.
 */

import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("rate-limit");

// ── In-memory fallback rate limiter ─────────────────────────
// Used when the Cloudflare rate-limiter worker is unreachable.
// Provides degraded but functional protection against abuse.
interface LocalBucket {
  count: number;
  expiresAt: number;
}
const LOCAL_BUCKETS = new Map<string, LocalBucket>();
const LOCAL_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const LOCAL_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 20;
const LOCAL_MAX_BUCKETS = 5000; // cap memory usage

/** Periodically purge expired buckets to prevent memory bloat. */
let _lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 120_000; // 2 minutes

function cleanupExpiredBuckets(): void {
  const now = Date.now();
  if (now - _lastCleanup < CLEANUP_INTERVAL_MS) return;
  _lastCleanup = now;

  // Collect keys first to avoid mutating Map during iteration
  const expiredKeys: string[] = [];
  for (const [key, bucket] of LOCAL_BUCKETS) {
    if (bucket.expiresAt <= now) {
      expiredKeys.push(key);
    }
  }
  for (const key of expiredKeys) {
    LOCAL_BUCKETS.delete(key);
  }
}

/**
 * In-memory rate limiter for use when the external worker is unavailable
 * or for endpoints that don't need external rate limiting (e.g. admin routes).
 */
export function checkLocalRateLimit(
  key: string,
  action: string,
  maxRequests: number = LOCAL_MAX_REQUESTS
): { limited: boolean; retryAfter?: number } {
  cleanupExpiredBuckets();

  const bucketKey = `${action}:${key}`;
  const now = Date.now();
  const existing = LOCAL_BUCKETS.get(bucketKey);

  if (existing && existing.expiresAt > now) {
    existing.count++;
    // LRU: move to end of Map insertion order by re-inserting
    LOCAL_BUCKETS.delete(bucketKey);
    LOCAL_BUCKETS.set(bucketKey, existing);
    if (existing.count > maxRequests) {
      const retryAfter = Math.ceil((existing.expiresAt - now) / 1000);
      return { limited: true, retryAfter };
    }
    return { limited: false };
  }

  // Evict least-recently-used entries if at capacity
  if (LOCAL_BUCKETS.size >= LOCAL_MAX_BUCKETS) {
    const firstKey = LOCAL_BUCKETS.keys().next().value;
    if (firstKey !== undefined) LOCAL_BUCKETS.delete(firstKey);
  }

  LOCAL_BUCKETS.set(bucketKey, { count: 1, expiresAt: now + LOCAL_WINDOW_MS });
  return { limited: false };
}

interface RateLimitOptions {
  /** Unique key identifying the client (IP, phone, user ID, etc.) */
  key: string;
  /** Action being rate-limited (e.g. "auth:login", "otp:send") */
  action: string;
  /** Optional device/session identifier */
  deviceId?: string;
  /**
   * How to behave when the shared rate-limiter worker is unavailable.
   * `local` preserves availability with a per-instance fallback.
   * `block` fails closed for sensitive flows that should not continue without shared abuse controls.
   */
  degradedMode?: "local" | "block";
  /** When true, check the counter without incrementing (read-only). */
  readOnly?: boolean;
}

interface RateLimitResult {
  limited: boolean;
  retryAfter?: number;
  degraded?: boolean;
}

export interface ClientRateLimitIdentity {
  key: string;
  source: "cf-connecting-ip" | "x-forwarded-for" | "x-real-ip" | "fingerprint" | "unknown";
  ip?: string;
}

function degradedBlockResult(retryAfter = 60): RateLimitResult {
  return { limited: true, retryAfter, degraded: true };
}

function readHeaderValue(request: Request, headerName: string): string | null {
  const value = request.headers.get(headerName);
  if (!value) {
    return null;
  }

  const normalizedValue =
    headerName === "x-forwarded-for" ? value.split(",")[0]?.trim() : value.trim();

  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : null;
}

function hashFingerprint(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildClientFingerprint(request: Request): string | null {
  const fingerprintParts = [
    readHeaderValue(request, "user-agent"),
    readHeaderValue(request, "accept-language"),
    readHeaderValue(request, "sec-ch-ua"),
    readHeaderValue(request, "sec-ch-ua-platform"),
    readHeaderValue(request, "host"),
  ].filter((value): value is string => Boolean(value));

  if (fingerprintParts.length === 0) {
    return null;
  }

  return `fp:${hashFingerprint(fingerprintParts.join("|"))}`;
}

export function getClientRateLimitIdentity(request: Request): ClientRateLimitIdentity {
  const cfConnectingIp = readHeaderValue(request, "cf-connecting-ip");
  if (cfConnectingIp) {
    return { key: cfConnectingIp, source: "cf-connecting-ip", ip: cfConnectingIp };
  }

  const forwardedIp = readHeaderValue(request, "x-forwarded-for");
  if (forwardedIp) {
    return { key: forwardedIp, source: "x-forwarded-for", ip: forwardedIp };
  }

  const realIp = readHeaderValue(request, "x-real-ip");
  if (realIp) {
    return { key: realIp, source: "x-real-ip", ip: realIp };
  }

  const fingerprint = buildClientFingerprint(request);
  if (fingerprint) {
    return { key: fingerprint, source: "fingerprint" };
  }

  return { key: "unknown", source: "unknown" };
}

export function getClientRateLimitKey(request: Request): string {
  return getClientRateLimitIdentity(request).key;
}

/**
 * Check the external rate-limiter worker.
 *
 * Returns `{ limited: true, retryAfter }` if the request should be blocked,
 * or `{ limited: false }` if the request should proceed.
 *
 * Fails open: if the worker is unavailable or errors, returns `{ limited: false }`.
 */
export async function checkRateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const url = process.env.OTP_RATE_LIMITER_URL;
  if (!url) {
    if (opts.degradedMode === "block") {
      // In e2e test mode, fall back to local rate limiter instead of blocking
      // every request — the external worker is intentionally absent.
      if (process.env.VERIFYMZANSI_RUNTIME_MODE === "e2e") {
        return { ...checkLocalRateLimit(opts.key, opts.action), degraded: true };
      }
      logger.error("Shared rate limiter is not configured for a fail-closed action", {
        action: opts.action,
      });
      return degradedBlockResult();
    }

    // No external rate-limiter configured — fall back to in-memory limiter
    // instead of failing open with no protection.
    return { ...checkLocalRateLimit(opts.key, opts.action), degraded: true };
  }

  const timeout = Number(process.env.OTP_RATE_LIMITER_TIMEOUT_MS) || 2500;
  const apiKey = process.env.RATE_LIMITER_API_KEY;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          key: opts.key,
          action: opts.action,
          deviceId: opts.deviceId,
          readOnly: opts.readOnly,
        }),
        signal: controller.signal,
      });

      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as {
          retryAfter?: number;
        };
        logger.warn("Rate limited", { action: opts.action, key: opts.key });
        return { limited: true, retryAfter: data.retryAfter ?? 60 };
      }

      return { limited: false };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (opts.degradedMode === "block") {
      logger.error("Rate limiter worker unreachable for fail-closed action", {
        action: opts.action,
        error: err instanceof Error ? err.message : "unknown",
      });
      return degradedBlockResult();
    }

    // Fail degraded — use local in-memory rate limiter as fallback
    logger.error("Rate limiter worker unreachable, using local fallback", {
      action: opts.action,
      error: err instanceof Error ? err.message : "unknown",
    });
    return { ...checkLocalRateLimit(opts.key, opts.action), degraded: true };
  }
}

/**
 * Extract client IP from request headers.
 * Prefers cf-connecting-ip, falls back to x-forwarded-for, then x-real-ip.
 */
export function getClientIp(request: Request): string {
  return getClientRateLimitIdentity(request).ip ?? "unknown";
}
