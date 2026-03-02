/**
 * Cloudflare Worker – OTP Rate Limiter
 *
 * Deploy alongside the Next.js app and call from /api/otp/send before
 * dispatching the actual OTP.
 *
 * Bindings required in wrangler.toml:
 *   [[kv_namespaces]]
 *   binding = "OTP_RATE_LIMITS"
 *   id     = "<your-kv-namespace-id>"
 */

// Cloudflare Workers KV type (provided by @cloudflare/workers-types at runtime)
declare interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface Env {
  OTP_RATE_LIMITS: KVNamespace;
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

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Health check endpoint
    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          worker: "verifymzansi-rate-limiter",
          status: "healthy",
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
    // e.g. "0821234567" → "+27821234567", "27821234567" → "+27821234567"
    const phone = normalizePhone(rawPhone);

    // Define tiered rate limits
    const checks: RateCheck[] = [
      { key: `otp:send:${phone}`, limit: 1, ttl: 60 }, // 1 per 60 s
      { key: `otp:hour:${phone}`, limit: 5, ttl: 3600 }, // 5 per hour
      { key: `otp:day:${phone}`, limit: 10, ttl: 86400 }, // 10 per day
    ];

    if (deviceId) {
      checks.push({ key: `otp:device:${deviceId}`, limit: 20, ttl: 86400 }); // 20 per device per day
    }

    // Check limits before incrementing
    for (const check of checks) {
      const current = parseInt((await env.OTP_RATE_LIMITS.get(check.key)) || "0", 10);
      if (current >= check.limit) {
        return Response.json({ error: "rate_limited", retryAfter: check.ttl }, { status: 429 });
      }
    }

    // Increment all counters
    // NOTE: This read-then-write pattern has a TOCTOU race condition under
    // high concurrency.  KV does not support atomic increment.  For stricter
    // guarantees, migrate to Cloudflare Durable Objects or D1 with a
    // transactional counter.  The current approach is acceptable for
    // moderate traffic volumes.
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
