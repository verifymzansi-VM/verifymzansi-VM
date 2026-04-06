import * as Sentry from "@sentry/nextjs";

let hasLoggedBootstrapValidationFailure = false;

function isExplicitE2eRuntime(): boolean {
  const e2eModes = new Set(["e2e", "playwright", "test"]);
  const runtimeMode = process.env.VERIFYMZANSI_RUNTIME_MODE?.trim().toLowerCase();
  const validationMode = process.env.VERIFYMZANSI_VALIDATION_MODE?.trim().toLowerCase();

  return e2eModes.has(runtimeMode ?? "") || e2eModes.has(validationMode ?? "");
}

function shouldSoftFailEnvValidationInProduction(): boolean {
  if (process.env.NODE_ENV !== "production" || isExplicitE2eRuntime()) {
    return false;
  }

  // Default to availability-first in production: env validation failures
  // should degrade health checks, not hard-crash the entire worker.
  // Set STRICT_ENV_STARTUP_BLOCK=1 to restore fail-closed startup behavior.
  return process.env.STRICT_ENV_STARTUP_BLOCK !== "1";
}

/**
 * Check for dev bypass environment variables that must never exist in production.
 * This runs independently of the full env validation to provide a hard safety net.
 */
function assertNoDevBypassesInProduction(): string[] {
  if (process.env.NODE_ENV !== "production" || isExplicitE2eRuntime()) return [];

  const violations: string[] = [];
  const dangerous: Record<string, string> = {
    BYPASS_OTP_CODE: "Allows OTP verification bypass",
    TEST_PHONE_NUMBERS: "Allows test phone numbers to skip real OTP",
    ENABLE_MOCK_OZOW: "Routes payments through mock endpoint",
    ENABLE_DEV_PAYMENT_BYPASS: "Bypasses payment verification",
    ENABLE_DEV_KYC_WEBHOOK_BYPASS: "Allows unsigned KYC webhooks in local development",
    DEV_EXPOSE_OTP: "Exposes OTP codes in API responses",
    SMS_MOCK: "Prevents real SMS delivery",
    PLAYWRIGHT_TEST_MODE: "Enables Turnstile CAPTCHA bypass and unsigned KYC webhooks",
    PLAYWRIGHT_SUPABASE_MODE: "Routes auth/data through Playwright stub clients",
    PLAYWRIGHT_E2E_AUTH: "Allows persona-based Playwright session auth shortcuts",
    NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE: "Enables client Playwright test toggles in production",
    NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE:
      "Enables client Supabase Playwright stub mode in production",
    ENABLE_TEST_POSTING_BYPASS: "Removes posting count limits",
    NEXT_PUBLIC_ENABLE_TEST_POSTING_BYPASS: "Client-side posting limit bypass",
    ENABLE_DEV_TURNSTILE_BYPASS: "Allows CAPTCHA verification bypass",
  };

  for (const [key, description] of Object.entries(dangerous)) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      violations.push(`${key}: ${description}`);
    }
  }

  return violations;
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
      release: `verifymzansi@${process.env.npm_package_version || "1.0.0"}`,
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
      release: `verifymzansi@${process.env.npm_package_version || "1.0.0"}`,
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    });
  }

  const [{ validateEnv }, { createLogger }] = await Promise.all([
    import("./lib/config/env"),
    import("./lib/utils/logger"),
  ]);

  const logger = createLogger("Instrumentation");

  // Hard guard: reject placeholder encryption keys in production.
  // This runs BEFORE env validation so it is never soft-failed.
  if (process.env.NODE_ENV === "production" && !isExplicitE2eRuntime()) {
    const CAFEBABE = "cafebabe".repeat(8);
    const placeholderVars = ["KYC_ENCRYPTION_KEY", "ID_ENCRYPTION_KEY", "HMAC_SECRET"] as const;
    const insecure = placeholderVars.filter((k) => process.env[k] === CAFEBABE);
    if (insecure.length > 0) {
      const logger = (await import("./lib/utils/logger")).createLogger("Instrumentation");
      logger.error(
        `Production startup blocked: placeholder encryption keys detected: ${insecure.join(", ")}`
      );
      throw new Error(
        `Production startup blocked: placeholder encryption keys detected (${insecure.join(", ")}). ` +
          `Generate real keys with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
      );
    }
  }

  // Hard guard: block production startup if dev bypasses are present
  const devBypassViolations = assertNoDevBypassesInProduction();
  if (devBypassViolations.length > 0) {
    const message = [
      "",
      "╔══════════════════════════════════════════════════════╗",
      "║  CRITICAL: Dev bypass variables detected in prod    ║",
      "╚══════════════════════════════════════════════════════╝",
      "",
      ...devBypassViolations.map((v) => `  ✗ ${v}`),
      "",
      "Remove these variables from your production environment",
      "before deploying. They weaken authentication and payment",
      "security in ways that could expose real user data.",
      "",
    ].join("\n");

    logger.error(message);
    throw new Error(
      `Production startup blocked: ${devBypassViolations.length} dev bypass variable(s) detected. ` +
        `Remove: ${devBypassViolations.map((v) => v.split(":")[0]).join(", ")}`
    );
  }

  try {
    validateEnv();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (!hasLoggedBootstrapValidationFailure) {
      hasLoggedBootstrapValidationFailure = true;
      logger.error("Launch configuration validation failed during instrumentation bootstrap", {
        error: errorMessage,
      });
    }

    if (shouldSoftFailEnvValidationInProduction()) {
      logger.error("Continuing startup with degraded launch configuration", {
        reason: "STRICT_ENV_STARTUP_BLOCK is not enabled",
      });
      return;
    }

    throw error;
  }
}

export function _resetInstrumentationForTesting() {
  hasLoggedBootstrapValidationFailure = false;
}

export const onRequestError = Sentry.captureRequestError;
