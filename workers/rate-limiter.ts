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

import { z } from "zod";

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

interface RateCheck {
  key: string;
  limit: number;
  /** Time-to-live in seconds */
  ttl: number;
}

/**
 * Action-specific rate limit configurations.
 * Used for generic (non-OTP) rate limiting via the same DO infrastructure.
 *
 * Every action sent by the app MUST be listed here. Unknown actions that
 * fall through to the OTP path will be treated as OTP sends (1 per 60 s)
 * which is catastrophically wrong for read endpoints.
 */
const ACTION_LIMITS: Record<string, { limit: number; ttl: number }[]> = {
  // ── Auth ─────────────────────────────────────────────
  "auth:lockout": [{ limit: 5, ttl: 3600 }], // 5 failed logins per email per hour
  "auth:login": [
    { limit: 10, ttl: 60 }, // 10 per minute
    { limit: 30, ttl: 3600 }, // 30 per hour
  ],
  "auth:register": [
    { limit: 5, ttl: 60 }, // 5 per minute
    { limit: 15, ttl: 3600 }, // 15 per hour
  ],

  // ── Public reads (generous — browsing with filters/pagination) ──
  "businesses:read": [{ limit: 120, ttl: 60 }], // 120 per minute
  "promotions:read": [{ limit: 120, ttl: 60 }], // 120 per minute
  "listings:read": [{ limit: 120, ttl: 60 }], // 120 per minute

  // ── Profile ──────────────────────────────────────────
  "profile:update": [{ limit: 10, ttl: 60 }],
  "profile:avatar": [{ limit: 5, ttl: 60 }],

  // ── Verification ─────────────────────────────────────
  "verification:upload": [{ limit: 10, ttl: 60 }],
  "verification:status": [{ limit: 30, ttl: 60 }], // polling-friendly
  "verification:gps": [{ limit: 10, ttl: 60 }],

  // ── Billing / webhooks ───────────────────────────────
  "billing:checkout": [{ limit: 10, ttl: 60 }],
  "webhook:ozow": [{ limit: 100, ttl: 60 }], // webhooks can be bursty

  // ── Media ────────────────────────────────────────────
  "media:upload": [{ limit: 20, ttl: 60 }],

  // ── Contact ──────────────────────────────────────────
  "contact:send": [
    { limit: 5, ttl: 60 },
    { limit: 15, ttl: 3600 },
  ],
  "contact:general": [
    { limit: 5, ttl: 60 },
    { limit: 15, ttl: 3600 },
  ],

  // ── Reports ──────────────────────────────────────────
  "report:submit": [
    { limit: 5, ttl: 60 },
    { limit: 15, ttl: 3600 },
  ],

  // ── Promotions management ────────────────────────────
  "promotion:featured": [{ limit: 10, ttl: 60 }],
  "promotion:boost": [{ limit: 10, ttl: 60 }],
};

interface CounterEntry {
  count: number;
  expiresAt: number;
}

const rateLimitCheckSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "Rate limit key is required")
    .max(160, "Rate limit key is too long"),
  limit: z.number().int().min(1, "Rate limit limit must be at least 1").max(10_000),
  ttl: z.number().int().min(1, "Rate limit ttl must be at least 1").max(31_536_000),
});

const durableObjectPayloadSchema = z.object({
  checks: z.array(rateLimitCheckSchema).min(1, "At least one rate limit check is required").max(10),
  readOnly: z.boolean().optional(),
});

const externalWorkerPayloadSchema = z.object({
  key: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().max(160, "key is too long").optional()),
  phone: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().max(32, "phone is too long").optional()),
  deviceId: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().max(160, "deviceId is too long").optional()),
  action: z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
    z
      .string()
      .max(64, "action is too long")
      .regex(/^[a-z0-9:_-]+$/i, "action contains invalid characters")
      .optional()
  ),
  readOnly: z.boolean().optional(),
});

function validationError(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
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

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return validationError("Invalid JSON body");
    }

    const parsedPayload = durableObjectPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) {
      return validationError(parsedPayload.error.issues[0]?.message ?? "Invalid rate limit checks");
    }

    const { checks, readOnly } = parsedPayload.data;
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

    // Skip increment when readOnly is true (check-only mode for lockout queries)
    if (readOnly) {
      return Response.json({ ok: true });
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

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsedPayload = externalWorkerPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) {
      return validationError(parsedPayload.error.issues[0]?.message ?? "Invalid request body");
    }

    const { key: rawKey, phone: legacyPhone, deviceId, action, readOnly } = parsedPayload.data;
    const rawPhone = rawKey || legacyPhone;

    // Generic action-based rate limiting
    if (action) {
      // Use configured limits, or a safe default for unknown actions
      // (prevents unknown actions from falling through to OTP limits)
      const limits = ACTION_LIMITS[action] ?? [{ limit: 30, ttl: 60 }];
      const rateKey = rawPhone || "";
      if (!rateKey) {
        return Response.json({ error: "key is required" }, { status: 400 });
      }

      if (env.RATE_LIMITER_DO) {
        try {
          const doId = env.RATE_LIMITER_DO.idFromName(`${action}:${rateKey}`);
          const stub = env.RATE_LIMITER_DO.get(doId);
          const checks: RateCheck[] = limits.map((c) => ({
            key: `${action}:${rateKey}`,
            limit: c.limit,
            ttl: c.ttl,
          }));
          return await stub.fetch(
            new Request("https://do.internal/check", {
              method: "POST",
              body: JSON.stringify({ checks, readOnly: !!readOnly }),
            })
          );
        } catch {
          // Fall through to KV fallback
        }
      }

      // KV fallback for generic actions
      for (const c of limits) {
        const k = `${action}:${rateKey}`;
        const current = parseInt((await env.OTP_RATE_LIMITS.get(k)) || "0", 10);
        if (current >= c.limit) {
          return Response.json({ error: "rate_limited", retryAfter: c.ttl }, { status: 429 });
        }
        if (!readOnly) {
          await env.OTP_RATE_LIMITS.put(k, String(current + 1), { expirationTtl: c.ttl });
        }
      }
      return Response.json({ ok: true });
    }

    // ── OTP-specific rate limiting (default flow) ───────────────────────
    if (!rawPhone) {
      return Response.json({ error: "key is required" }, { status: 400 });
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

    // KV fallback — kept for backward compatibility during migration.
    // Read-check-increment in a single pass to minimise the TOCTOU window.
    // (True atomicity requires the Durable Object path above.)
    const kvSnapshots: { check: RateCheck; current: number }[] = [];
    for (const check of checks) {
      const current = parseInt((await env.OTP_RATE_LIMITS.get(check.key)) || "0", 10);
      if (current >= check.limit) {
        return Response.json({ error: "rate_limited", retryAfter: check.ttl }, { status: 429 });
      }
      kvSnapshots.push({ check, current });
    }

    // Increment immediately after all checks pass — no second read pass.
    for (const { check, current } of kvSnapshots) {
      await env.OTP_RATE_LIMITS.put(check.key, String(current + 1), {
        expirationTtl: check.ttl,
      });
    }

    return Response.json({ ok: true });
  },
};

export default worker;
