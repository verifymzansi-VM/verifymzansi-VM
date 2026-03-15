/**
 * Cloudflare Worker – OTP Rate Limiter
 *
 * Uses a Durable Object for atomic counter increments, eliminating the
 * TOCTOU race condition that existed in the previous KV-based approach.
 *
 * Bindings required in wrangler.toml:
 *   [durable_objects]
 *   bindings = [{ name = "RATE_LIMITER_DO", class_name = "RateLimiterDO" }]
 *
 *   [[kv_namespaces]]
 *   binding = "OTP_RATE_LIMITS"
 *   id     = "<your-kv-namespace-id>"
 *   # KV kept as fallback if DO is unavailable during migration
 */

// Cloudflare Workers KV type (provided by @cloudflare/workers-types at runtime)
declare interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

declare interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

declare interface DurableObjectId {
  toString(): string;
}

declare interface DurableObjectStub {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}

declare interface DurableObjectState {
  storage: DurableObjectStorage;
}

declare interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAll(): Promise<void>;
}

interface Env {
  OTP_RATE_LIMITS: KVNamespace;
  RATE_LIMITER_DO: DurableObjectNamespace;
  WORKER_API_KEY: string;
}

interface RateCheckPayload {
  phone: string;
  deviceId?: string;
}

interface RateCheck {
  key: string;
  limit: number;
  /** Time-to-live in seconds */
  ttl: number;
}

interface CounterEntry {
  count: number;
  expiresAt: number;
}

/**
 * Normalize a South African phone number to E.164 format (+27...).
 * Prevents bypass by submitting the same number in different formats.
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^0-9+]/g, "");
  if (digits.startsWith("+27")) return digits;
  if (digits.startsWith("27") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("0") && digits.length >= 10) return `+27${digits.slice(1)}`;
  return digits; // fallback: use as-is
}

// ── Durable Object: Atomic Rate Limiter ─────────────────────────────────────
// Each phone number gets its own DO instance, ensuring all counter reads
// and writes are serialized — no TOCTOU race conditions.

export class RateLimiterDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const { checks } = (await request.json()) as { checks: RateCheck[] };
    const now = Date.now();

    // All reads and writes happen within a single DO — fully serialized
    for (const check of checks) {
      const entry = await this.state.storage.get<CounterEntry>(check.key);
      const current = entry && entry.expiresAt > now ? entry.count : 0;

      if (current >= check.limit) {
        const retryAfter = entry ? Math.ceil((entry.expiresAt - now) / 1000) : check.ttl;
        return Response.json({ error: "rate_limited", retryAfter }, { status: 429 });
      }
    }

    // Atomically increment all counters
    for (const check of checks) {
      const entry = await this.state.storage.get<CounterEntry>(check.key);
      const now2 = Date.now();
      const current = entry && entry.expiresAt > now2 ? entry.count : 0;
      const expiresAt = entry && entry.expiresAt > now2 ? entry.expiresAt : now2 + check.ttl * 1000;

      await this.state.storage.put(check.key, {
        count: current + 1,
        expiresAt,
      } satisfies CounterEntry);
    }

    // Schedule alarm to clean up expired entries (self-gc)
    await this.state.storage.setAlarm(Date.now() + 86_400_000); // 24h

    return Response.json({ ok: true });
  }

  /** Periodic cleanup of expired counters. */
  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}

// ── Worker entry point ──────────────────────────────────────────────────────

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Health check endpoint
    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          worker: "verifymzansi-rate-limiter",
          status: "healthy",
          backend: env.RATE_LIMITER_DO ? "durable-object" : "kv-fallback",
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Only accept POST
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Authenticate caller via shared secret
    const authHeader = request.headers.get("Authorization");
    if (!env.WORKER_API_KEY || authHeader !== `Bearer ${env.WORKER_API_KEY}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    let payload: RateCheckPayload;
    try {
      payload = (await request.json()) as RateCheckPayload;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { phone: rawPhone, deviceId } = payload;

    if (!rawPhone) {
      return Response.json({ error: "phone is required" }, { status: 400 });
    }

    // Normalize phone to E.164 format to prevent bypass via alternate formats
    const phone = normalizePhone(rawPhone);

    // Define tiered rate limits
    const checks: RateCheck[] = [
      { key: `otp:send:${phone}`, limit: 1, ttl: 60 }, // 1 per 60 s
      { key: `otp:hour:${phone}`, limit: 5, ttl: 3600 }, // 5 per hour
      { key: `otp:day:${phone}`, limit: 10, ttl: 86400 }, // 10 per day
    ];

    if (deviceId) {
      checks.push({ key: `otp:device:${deviceId}`, limit: 20, ttl: 86400 });
    }

    // Use Durable Object for atomic rate limiting (no TOCTOU race)
    if (env.RATE_LIMITER_DO) {
      try {
        const doId = env.RATE_LIMITER_DO.idFromName(phone);
        const stub = env.RATE_LIMITER_DO.get(doId);
        return await stub.fetch(
          new Request("https://do.internal/check", {
            method: "POST",
            body: JSON.stringify({ checks }),
          })
        );
      } catch {
        // Fall through to KV fallback if DO fails
      }
    }

    // KV fallback — kept for backward compatibility during migration
    for (const check of checks) {
      const current = parseInt((await env.OTP_RATE_LIMITS.get(check.key)) || "0", 10);
      if (current >= check.limit) {
        return Response.json({ error: "rate_limited", retryAfter: check.ttl }, { status: 429 });
      }
    }

    for (const check of checks) {
      const current = parseInt((await env.OTP_RATE_LIMITS.get(check.key)) || "0", 10);
      await env.OTP_RATE_LIMITS.put(check.key, String(current + 1), {
        expirationTtl: check.ttl,
      });
    }

    return Response.json({ ok: true });
  },
};

export default worker;
