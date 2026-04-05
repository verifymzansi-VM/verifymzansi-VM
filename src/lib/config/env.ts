import { z } from "zod";
import {
  resolveLaunchValidationMode,
  validateLaunchConfiguration,
  type LaunchValidationMode,
} from "./launch-validation";

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

  // ── Cloudflare R2 (optional — production uses native R2 bindings from wrangler.toml) ──
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_PUBLIC_BUCKET: z.string().default("verifymzansi-public"),
  R2_PRIVATE_BUCKET: z.string().default("verifymzansi-private"),
  R2_PUBLIC_URL: z.string().optional(),

  // ── Media CDN ─────────────────────────────────────────────
  NEXT_PUBLIC_MEDIA_URL: z.string().url().optional(),
  NEXT_PUBLIC_CF_IMAGE_RESIZING: z.enum(["true", "false"]).default("false"),

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
  RATE_LIMITER_API_KEY: z.string().min(1).optional(),

  // ── Ozow (validated for production launch paths)
  OZOW_ENV: z.enum(["staging", "production"]).optional(),
  OZOW_CLIENT_ID: z.string().optional(),
  OZOW_CLIENT_SECRET: z.string().optional(),
  OZOW_SITE_CODE: z.string().optional(),
  OZOW_API_BASE_URL: z.string().url().optional(),
  OZOW_WEBHOOK_SECRET: z.string().optional(),
  KYC_WEBHOOK_SECRET: z.string().optional(),

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

  // ── Runtime / E2E bypass flags (always optional) ──────────
  PLAYWRIGHT_E2E_AUTH: z.enum(["0", "1"]).optional(),
  VERIFYMZANSI_RUNTIME_MODE: z
    .enum(["development", "e2e", "playwright", "test", "production"])
    .optional(),
  VERIFYMZANSI_VALIDATION_MODE: z.string().optional(),
  STRICT_ENV_STARTUP_BLOCK: z.enum(["0", "1"]).optional(),
});

export type Env = z.infer<typeof envSchema>;

export interface ValidateEnvOptions {
  mode?: LaunchValidationMode;
  strict?: boolean;
}

let _cachedEnv: Env | null = null;
const _emittedLaunchWarnings = new Set<string>();

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
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_PUBLIC_BUCKET: process.env.R2_PUBLIC_BUCKET || "verifymzansi-public",
    R2_PRIVATE_BUCKET: process.env.R2_PRIVATE_BUCKET || "verifymzansi-private",
    R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
    NEXT_PUBLIC_MEDIA_URL: process.env.NEXT_PUBLIC_MEDIA_URL,
    NEXT_PUBLIC_CF_IMAGE_RESIZING:
      (process.env.NEXT_PUBLIC_CF_IMAGE_RESIZING as "true" | "false") || "false",
    // SECURITY: Use clearly-invalid placeholders that FAIL runtime Zod
    // validation.  The "INVALID" substring contains non-hex chars, so the
    // `.regex(/^[0-9a-fA-F]+$/)` guard rejects them before any crypto path.
    KYC_ENCRYPTION_KEY: process.env.KYC_ENCRYPTION_KEY || "INVALID_BUILD_PLACEHOLDER_KYC_KEY__",
    ID_ENCRYPTION_KEY: process.env.ID_ENCRYPTION_KEY || "INVALID_BUILD_PLACEHOLDER_ID_KEY___",
    HMAC_SECRET: process.env.HMAC_SECRET || "INVALID_BUILD_PLACEHOLDER_HMAC_SEC_",
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
    RATE_LIMITER_API_KEY: process.env.RATE_LIMITER_API_KEY,
    OZOW_ENV: process.env.OZOW_ENV as "staging" | "production" | undefined,
    OZOW_CLIENT_ID: process.env.OZOW_CLIENT_ID,
    OZOW_CLIENT_SECRET: process.env.OZOW_CLIENT_SECRET,
    OZOW_SITE_CODE: process.env.OZOW_SITE_CODE,
    OZOW_API_BASE_URL: process.env.OZOW_API_BASE_URL,
    OZOW_WEBHOOK_SECRET: process.env.OZOW_WEBHOOK_SECRET,
    KYC_WEBHOOK_SECRET: process.env.KYC_WEBHOOK_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY || "",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "",
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || "",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    NODE_ENV: (process.env.NODE_ENV as "development" | "production" | "test") || "development",
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    PLAYWRIGHT_E2E_AUTH: process.env.PLAYWRIGHT_E2E_AUTH as "0" | "1" | undefined,
    VERIFYMZANSI_RUNTIME_MODE: process.env.VERIFYMZANSI_RUNTIME_MODE as
      | "development"
      | "e2e"
      | "playwright"
      | "test"
      | "production"
      | undefined,
    VERIFYMZANSI_VALIDATION_MODE: process.env.VERIFYMZANSI_VALIDATION_MODE,
    STRICT_ENV_STARTUP_BLOCK: process.env.STRICT_ENV_STARTUP_BLOCK as "0" | "1" | undefined,
  } as Env;
}

/**
 * Validate all environment variables and return typed config.
 * Caches the result — safe to call multiple times.
 *
 * @throws {Error} with clear messages listing all missing/invalid vars
 */
function formatLaunchValidationFailure(
  mode: LaunchValidationMode,
  errors: ReturnType<typeof validateLaunchConfiguration>["errors"]
): string {
  const details = errors.map((error) => `  ✗ ${error.name}: ${error.detail}`).join("\n");

  return [
    "",
    "══════════════════════════════════════════════════════",
    "  VerifyMzansi — Launch Configuration Error",
    "══════════════════════════════════════════════════════",
    "",
    `Launch validation mode: ${mode}`,
    "",
    details,
    "",
    "See README.md and LAUNCH-CHECKLIST.md for the required launch variables.",
    "══════════════════════════════════════════════════════",
    "",
  ].join("\n");
}

function toEnvSource(env: Env): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      value === undefined ? undefined : String(value),
    ])
  );
}

function validateRateLimiterConfig(env: Env): void {
  if (env.RATE_LIMITER_API_KEY && !env.OTP_RATE_LIMITER_URL) {
    throw new Error(
      [
        "",
        "VerifyMzansi — Environment Configuration Error",
        "",
        "RATE_LIMITER_API_KEY is set but OTP_RATE_LIMITER_URL is missing.",
        "Configure both values together or remove RATE_LIMITER_API_KEY.",
        "",
      ].join("\n")
    );
  }
}

export function validateEnv(options: ValidateEnvOptions = {}): Env {
  if (_cachedEnv) return _cachedEnv;
  const validationMode = options.mode ?? resolveLaunchValidationMode(process.env);

  // Skip strict validation when running Next.js build or in CI
  // to allow static pages to compile without production secrets.
  // Critical vars are still verified to catch completely broken deployments.
  if (
    !options.strict &&
    (process.env.npm_lifecycle_event === "build" || process.env.CI === "true")
  ) {
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
    validateRateLimiterConfig(_cachedEnv);
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

  const launchSummary = validateLaunchConfiguration(toEnvSource(result.data), {
    mode: validationMode,
  });

  if (!launchSummary.isValid) {
    const msg = formatLaunchValidationFailure(validationMode, launchSummary.errors);
    if (options.strict && validationMode === "production") {
      // In strict production mode, launch validation failures are fatal.
      // This prevents deploying with insecure config (e.g. HTTP app URL).
      throw new Error(msg);
    }
    // At runtime, log non-fatally so one misconfigured service doesn't
    // block unrelated features (Zod schema is the authoritative guard).
    console.error(`[ENV] Launch validation failed (non-fatal):\n${msg}`);
  }

  validateRateLimiterConfig(result.data);

  // Hard guard: reject cafebabe placeholder encryption keys in production.
  // These are safe build-phase fallbacks that must never reach a live worker.
  if (result.data.NODE_ENV === "production") {
    const CAFEBABE = "cafebabe".repeat(8);
    const placeholderKeys: Array<[keyof Env, string]> = [
      ["KYC_ENCRYPTION_KEY", "KYC_ENCRYPTION_KEY"],
      ["ID_ENCRYPTION_KEY", "ID_ENCRYPTION_KEY"],
      ["HMAC_SECRET", "HMAC_SECRET"],
    ];
    const insecure = placeholderKeys.filter(([k]) => result.data[k] === CAFEBABE);
    if (insecure.length > 0) {
      const names = insecure.map(([, label]) => label).join(", ");
      throw new Error(
        [
          "",
          "══════════════════════════════════════════════════════",
          "  VerifyMzansi — Insecure Placeholder Keys Detected",
          "══════════════════════════════════════════════════════",
          "",
          `The following keys still contain the build-phase placeholder value (cafebabe…):`,
          "",
          `  ${names}`,
          "",
          "Generate real keys with:",
          "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
          "══════════════════════════════════════════════════════",
          "",
        ].join("\n")
      );
    }
  }

  if (result.data.NODE_ENV === "production" && !result.data.IP_HASH_SECRET) {
    throw new Error(
      [
        "",
        "VerifyMzansi — Environment Configuration Error",
        "",
        "IP_HASH_SECRET is required in production.",
        "Configure it before starting the app so audit and access logs can hash IP addresses safely.",
        "",
      ].join("\n")
    );
  }

  for (const warning of launchSummary.warnings) {
    const signature = `${warning.name}:${warning.detail}`;
    if (_emittedLaunchWarnings.has(signature)) {
      continue;
    }
    _emittedLaunchWarnings.add(signature);

    const runtimeMode = (result.data.VERIFYMZANSI_RUNTIME_MODE ?? "").toLowerCase();
    const isE2eRuntime =
      runtimeMode === "e2e" ||
      runtimeMode === "playwright" ||
      runtimeMode === "test" ||
      result.data.PLAYWRIGHT_E2E_AUTH === "1";

    const prefix = isE2eRuntime ? "[ENV] INFO" : "[ENV] WARNING";

    if (
      isE2eRuntime &&
      warning.name === "Dangerous env vars" &&
      warning.detail.includes("PLAYWRIGHT_E2E_AUTH")
    ) {
      continue;
    }

    console.warn(`${prefix}: ${warning.name}: ${warning.detail}`);
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
  _emittedLaunchWarnings.clear();
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
