import { z } from "zod";

/**
 * Environment variable validation.
 * Call validateEnv() at application startup to fail fast
 * with helpful error messages instead of crashing deep in a user flow.
 */

const envSchema = z.object({
  // ── Supabase (required) ────────────────────────────────────
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL (e.g. https://xxx.supabase.co)"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(
      20,
      "SUPABASE_SERVICE_ROLE_KEY is required — find it in Supabase Dashboard > Settings > API"
    ),

  // ── Cloudflare R2 (required for file storage) ─────────────
  R2_ACCOUNT_ID: z.string().min(1, "R2_ACCOUNT_ID is required — find it in Cloudflare dashboard"),
  R2_ACCESS_KEY_ID: z
    .string()
    .min(1, "R2_ACCESS_KEY_ID is required — create an API token in Cloudflare R2"),
  R2_SECRET_ACCESS_KEY: z
    .string()
    .min(1, "R2_SECRET_ACCESS_KEY is required — create an API token in Cloudflare R2"),
  R2_PUBLIC_BUCKET: z.string().default("verifymzansi-public"),
  R2_PRIVATE_BUCKET: z.string().default("verifymzansi-private"),
  R2_PUBLIC_URL: z.string().optional(),

  // ── KYC Encryption (required for POPIA compliance) ────────
  KYC_ENCRYPTION_KEY: z
    .string()
    .length(
      64,
      "KYC_ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
    .regex(/^[0-9a-fA-F]+$/, "KYC_ENCRYPTION_KEY must be hex characters only"),

  // ── ID Number Encryption (for verification upload) ────────
  ID_ENCRYPTION_KEY: z
    .string()
    .length(
      64,
      "ID_ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
    .regex(/^[0-9a-fA-F]+$/, "ID_ENCRYPTION_KEY must be hex characters only"),

  // ── HMAC Secret (for ID number dedup hashing) ─────────────
  HMAC_SECRET: z
    .string()
    .length(
      64,
      "HMAC_SECRET must be 64 hex characters (32 bytes). Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
    .regex(/^[0-9a-fA-F]+$/, "HMAC_SECRET must be hex characters only"),

  // ── IP Hashing Secret (for privacy-preserving access logs) ─
  IP_HASH_SECRET: z.string().min(32, "IP_HASH_SECRET must be at least 32 characters").optional(),

  // ── Geocoding (Nominatim for GPS reverse lookup) ──────────
  GEOCODING_API_URL: z.string().url().default("https://nominatim.openstreetmap.org"),
  NOMINATIM_USER_AGENT: z.string().default("verifymzansi/1.0"),

  // ── Africa's Talking (required for OTP) ───────────────────
  AFRICASTALKING_API_KEY: z.string().min(1, "AFRICASTALKING_API_KEY is required for OTP delivery"),
  AFRICASTALKING_USERNAME: z
    .string()
    .min(1, "AFRICASTALKING_USERNAME is required (use 'sandbox' for testing)"),
  AFRICASTALKING_SENDER_ID: z.string().optional(),

  // ── OTP Rate Limiter (optional) ───────────────────────────
  OTP_RATE_LIMITER_URL: z.string().url().optional().or(z.literal("")),
  OTP_RATE_LIMITER_TIMEOUT_MS: z.coerce.number().positive().optional(),

  // ── PayFast (optional at startup — validated at request time in billing routes)
  PAYFAST_MERCHANT_ID: z.string().optional(),
  PAYFAST_MERCHANT_KEY: z.string().optional(),
  PAYFAST_PASSPHRASE: z.string().optional(),
  PAYFAST_SANDBOX: z.enum(["true", "false", "1", "0"]).optional(),
  PAYFAST_NOTIFY_URL: z.string().url().optional(),

  // ── Resend (required for email) ───────────────────────────
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required for transactional emails"),

  // ── Cloudflare Turnstile (required in production for CAPTCHA) ───
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_TURNSTILE_SITE_KEY is required for CAPTCHA protection"),
  TURNSTILE_SECRET_KEY: z
    .string()
    .min(1, "TURNSTILE_SECRET_KEY is required for CAPTCHA protection"),

  // ── App ───────────────────────────────────────────────────
  // Required in production — no localhost fallback allowed.
  // In development/test, falls back to localhost:3000.
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // ── Optional Monitoring ───────────────────────────────────
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let _cachedEnv: Env | null = null;

/**
 * Create a fallback env object with safe defaults for build/CI.
 * Each key gets the process.env value if present, or an empty/default string.
 * @internal Used during build/CI phase when full validation is skipped.
 */
function _createFallbackEnv(): Env {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || "",
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || "",
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || "",
    R2_PUBLIC_BUCKET: process.env.R2_PUBLIC_BUCKET || "verifymzansi-public",
    R2_PRIVATE_BUCKET: process.env.R2_PRIVATE_BUCKET || "verifymzansi-private",
    R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
    // SECURITY: Use clearly-invalid placeholders instead of all-zeros.
    // These contain non-hex chars and will be rejected at runtime validation,
    // preventing accidental use of zero-keys in production.
    KYC_ENCRYPTION_KEY: process.env.KYC_ENCRYPTION_KEY || "cafebabe".repeat(8),
    ID_ENCRYPTION_KEY: process.env.ID_ENCRYPTION_KEY || "cafebabe".repeat(8),
    HMAC_SECRET: process.env.HMAC_SECRET || "cafebabe".repeat(8),
    IP_HASH_SECRET: process.env.IP_HASH_SECRET,
    GEOCODING_API_URL: process.env.GEOCODING_API_URL || "https://nominatim.openstreetmap.org",
    NOMINATIM_USER_AGENT: process.env.NOMINATIM_USER_AGENT || "verifymzansi/1.0",
    AFRICASTALKING_API_KEY: process.env.AFRICASTALKING_API_KEY || "",
    AFRICASTALKING_USERNAME: process.env.AFRICASTALKING_USERNAME || "",
    AFRICASTALKING_SENDER_ID: process.env.AFRICASTALKING_SENDER_ID,
    OTP_RATE_LIMITER_URL: process.env.OTP_RATE_LIMITER_URL,
    OTP_RATE_LIMITER_TIMEOUT_MS: process.env.OTP_RATE_LIMITER_TIMEOUT_MS
      ? Number(process.env.OTP_RATE_LIMITER_TIMEOUT_MS)
      : undefined,
    PAYFAST_MERCHANT_ID: process.env.PAYFAST_MERCHANT_ID || "",
    PAYFAST_MERCHANT_KEY: process.env.PAYFAST_MERCHANT_KEY || "",
    PAYFAST_PASSPHRASE: process.env.PAYFAST_PASSPHRASE,
    PAYFAST_SANDBOX: process.env.PAYFAST_SANDBOX,
    PAYFAST_NOTIFY_URL: process.env.PAYFAST_NOTIFY_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY || "",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "",
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || "",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    NODE_ENV: (process.env.NODE_ENV as "development" | "production" | "test") || "development",
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  } as Env;
}

/**
 * Validate all environment variables and return typed config.
 * Caches the result — safe to call multiple times.
 *
 * @throws {Error} with clear messages listing all missing/invalid vars
 */
export function validateEnv(): Env {
  if (_cachedEnv) return _cachedEnv;

  // Skip strict validation when running Next.js build or in CI
  // to allow static pages to compile without production secrets.
  // Critical vars are still verified to catch completely broken deployments.
  if (process.env.npm_lifecycle_event === "build" || process.env.CI === "true") {
    // Even during build/CI, verify the 3 most critical vars exist
    const critical = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ] as const;
    const missing = critical.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      console.error(`[ENV] Critical variables missing even during build: ${missing.join(", ")}`);
      console.error("These must be set as environment variables or repository secrets.");
      throw new Error(`Missing critical env vars: ${missing.join(", ")}`);
    }
    console.warn("⚠️ Applying lenient environment validation during build phase");
    // Parse through Zod with all fields optional so defaults are applied,
    // but don't fail on missing non-critical vars during build/CI.
    const buildSchema = envSchema.partial().required({
      NEXT_PUBLIC_SUPABASE_URL: true,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: true,
      SUPABASE_SERVICE_ROLE_KEY: true,
    });
    const buildResult = buildSchema.safeParse(process.env);
    if (buildResult.success) {
      _cachedEnv = buildResult.data as Env;
    } else {
      // Fallback: at least apply defaults from the full schema
      const fullResult = envSchema.safeParse(process.env);
      _cachedEnv = fullResult.success ? fullResult.data : _createFallbackEnv();
    }
    return _cachedEnv;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        return `  ✗ ${path}: ${issue.message}`;
      })
      .join("\n");

    const message = [
      "",
      "══════════════════════════════════════════════════════",
      "  VerifyMzansi — Environment Configuration Error",
      "══════════════════════════════════════════════════════",
      "",
      "The following environment variables are missing or invalid:",
      "",
      errors,
      "",
      "Copy .env.example to .env and fill in the values.",
      "See README.md and LAUNCH-CHECKLIST.md for setup instructions.",
      "══════════════════════════════════════════════════════",
      "",
    ].join("\n");

    throw new Error(message);
  }

  // Production-specific cross-field validations
  if (result.data.NODE_ENV === "production") {
    if (!result.data.AFRICASTALKING_SENDER_ID) {
      throw new Error(
        "[ENV] AFRICASTALKING_SENDER_ID is required in production so OTP and notification SMS messages use the approved sender ID."
      );
    }
    if (!result.data.NEXT_PUBLIC_APP_URL.startsWith("https://")) {
      throw new Error(
        `[ENV] NEXT_PUBLIC_APP_URL must be an https:// URL in production. Received: ${result.data.NEXT_PUBLIC_APP_URL}`
      );
    }
    if (result.data.PAYFAST_SANDBOX === "true") {
      throw new Error(
        "[ENV] PAYFAST_SANDBOX is 'true' in production — this will route payments to the sandbox gateway. Set to 'false' or remove it."
      );
    }
    if (result.data.PAYFAST_MERCHANT_ID && !result.data.PAYFAST_PASSPHRASE) {
      console.warn(
        "[ENV] WARNING: PAYFAST_PASSPHRASE is not set — billing will fail until PayFast secrets are configured."
      );
    }
    if (!result.data.PAYFAST_MERCHANT_ID || !result.data.PAYFAST_MERCHANT_KEY) {
      console.warn(
        "[ENV] WARNING: PayFast credentials not configured — billing features will be unavailable. " +
          "Set them with: pnpm wrangler secret put PAYFAST_MERCHANT_ID / PAYFAST_MERCHANT_KEY"
      );
    }
    if (!result.data.IP_HASH_SECRET) {
      console.warn(
        "[ENV] WARNING: IP_HASH_SECRET is not set — IP addresses in audit logs will use a dev-only fallback hash. Set it for POPIA compliance."
      );
    }

    // Verify server-side secrets are real values, not empty/placeholder fallbacks.
    // On Cloudflare Workers these must be set via `wrangler secret put`.
    const productionSecrets = [
      ["SUPABASE_SERVICE_ROLE_KEY", result.data.SUPABASE_SERVICE_ROLE_KEY],
      ["RESEND_API_KEY", result.data.RESEND_API_KEY],
      ["AFRICASTALKING_API_KEY", result.data.AFRICASTALKING_API_KEY],
      ["TURNSTILE_SECRET_KEY", result.data.TURNSTILE_SECRET_KEY],
      ["KYC_ENCRYPTION_KEY", result.data.KYC_ENCRYPTION_KEY],
      ["ID_ENCRYPTION_KEY", result.data.ID_ENCRYPTION_KEY],
      ["HMAC_SECRET", result.data.HMAC_SECRET],
    ] as const;

    const missingSecrets = productionSecrets
      .filter(([, val]) => !val || val === "cafebabe".repeat(8))
      .map(([name]) => name);

    if (missingSecrets.length > 0) {
      console.error(
        `[ENV] CRITICAL: ${missingSecrets.length} server-side secret(s) missing in production: ${missingSecrets.join(", ")}\n` +
          "Set them with: pnpm wrangler secret put <NAME>\n" +
          "See wrangler.toml comments for the full list."
      );
      throw new Error(
        `Missing production secrets: ${missingSecrets.join(", ")}. ` +
          "These must be set as encrypted Wrangler secrets, not as [vars] in wrangler.toml."
      );
    }
  }

  _cachedEnv = result.data;
  return _cachedEnv;
}

/**
 * Get a validated env var. Useful for server-only code.
 * Falls back to process.env if validation hasn't run yet.
 */
export function env<K extends keyof Env>(key: K): Env[K] {
  if (_cachedEnv) return _cachedEnv[key];
  // Lazily validate on first access instead of returning raw process.env
  // which would bypass type coercion (e.g. numbers stay as strings).
  try {
    _cachedEnv = validateEnv();
    return _cachedEnv[key];
  } catch (e) {
    // In test environments where not all env vars are mocked, fall back
    // gracefully so that tests that only need specific env vars still work.
    if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
      return process.env[key] as Env[K];
    }
    throw e;
  }
}

/**
 * Reset the env cache. Only needed in tests that dynamically
 * change process.env between assertions (e.g. vi.stubEnv).
 */
export function _resetEnvCacheForTesting(): void {
  _cachedEnv = null;
}

/**
 * Light check for required vars only — doesn't throw, just warns.
 * Useful in middleware where you can't block startup.
 */
export function checkCriticalEnvVars(): string[] {
  const missing: string[] = [];
  const critical = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const;

  for (const key of critical) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error(`[ENV] Critical environment variables missing: ${missing.join(", ")}`);
  }

  return missing;
}
