/**
 * Account lockout utility.
 *
 * Tracks failed login attempts per email and locks the account after
 * MAX_FAILED_ATTEMPTS within LOCKOUT_WINDOW_MS. Uses in-memory storage
 * with LRU eviction to bound memory usage.
 *
 * LIMITATION: On serverless runtimes (e.g. Cloudflare Workers) each isolate
 * has its own Map, so lockout state is not shared across instances and resets
 * when the isolate is recycled. For stronger protection, persist lockout state
 * in Cloudflare KV or a Durable Object.
 */

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_TRACKED_ACCOUNTS = 10_000;

interface FailedAttempt {
  timestamps: number[];
}

const failedAttempts = new Map<string, FailedAttempt>();

/** Periodically purge stale entries. */
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 120_000; // 2 minutes

function cleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  const cutoff = now - LOCKOUT_WINDOW_MS;
  const staleKeys: string[] = [];
  for (const [key, entry] of failedAttempts) {
    // Remove entries where all attempts are outside the window
    if (entry.timestamps.every((t) => t < cutoff)) {
      staleKeys.push(key);
    }
  }
  for (const key of staleKeys) {
    failedAttempts.delete(key);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Check if an account is locked out.
 * Returns `{ locked: true, retryAfter }` if the account has exceeded
 * the max failed attempts within the lockout window.
 */
export function checkAccountLockout(email: string): {
  locked: boolean;
  retryAfter?: number;
} {
  cleanup();

  const key = normalizeEmail(email);
  const entry = failedAttempts.get(key);
  if (!entry) return { locked: false };

  const now = Date.now();
  const cutoff = now - LOCKOUT_WINDOW_MS;
  const recentAttempts = entry.timestamps.filter((t) => t >= cutoff);

  if (recentAttempts.length >= MAX_FAILED_ATTEMPTS) {
    // Account is locked — calculate retry time from oldest relevant attempt
    const oldestRelevant = Math.min(...recentAttempts);
    const retryAfter = Math.ceil((oldestRelevant + LOCKOUT_WINDOW_MS - now) / 1000);
    return { locked: true, retryAfter: Math.max(retryAfter, 1) };
  }

  return { locked: false };
}

/**
 * Record a failed login attempt for an email address.
 */
export function recordFailedLogin(email: string): void {
  cleanup();

  const key = normalizeEmail(email);
  const now = Date.now();
  const cutoff = now - LOCKOUT_WINDOW_MS;

  const entry = failedAttempts.get(key);

  if (entry) {
    // Prune old timestamps and add new one
    entry.timestamps = entry.timestamps.filter((t) => t >= cutoff);
    entry.timestamps.push(now);
    // LRU: re-insert to maintain insertion order
    failedAttempts.delete(key);
    failedAttempts.set(key, entry);
  } else {
    // Evict oldest entry if at capacity
    if (failedAttempts.size >= MAX_TRACKED_ACCOUNTS) {
      const firstKey = failedAttempts.keys().next().value;
      if (firstKey !== undefined) failedAttempts.delete(firstKey);
    }
    failedAttempts.set(key, { timestamps: [now] });
  }
}

/**
 * Clear lockout state for an email (e.g. after successful login or password reset).
 */
export function clearLockout(email: string): void {
  failedAttempts.delete(normalizeEmail(email));
}

/** Visible for testing only. */
export function _resetForTesting(): void {
  failedAttempts.clear();
  lastCleanup = Date.now();
}
