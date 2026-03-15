let hasLoggedBootstrapValidationFailure = false;

/**
 * Check for dev bypass environment variables that must never exist in production.
 * This runs independently of the full env validation to provide a hard safety net.
 */
function assertNoDevBypassesInProduction(): string[] {
  if (process.env.NODE_ENV !== "production") return [];

  const violations: string[] = [];
  const dangerous: Record<string, string> = {
    BYPASS_OTP_CODE: "Allows OTP verification bypass",
    TEST_PHONE_NUMBERS: "Allows test phone numbers to skip real OTP",
    ENABLE_MOCK_OZOW: "Routes payments through mock endpoint",
    ENABLE_DEV_PAYMENT_BYPASS: "Bypasses payment verification",
    DEV_EXPOSE_OTP: "Exposes OTP codes in API responses",
    SMS_MOCK: "Prevents real SMS delivery",
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
  const [{ validateEnv }, { createLogger }] = await Promise.all([
    import("./lib/config/env"),
    import("./lib/utils/logger"),
  ]);

  const logger = createLogger("Instrumentation");

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
    // Surface launch misconfiguration without taking down every route.
    // /api/health and feature-level env access still report the problem.
    if (hasLoggedBootstrapValidationFailure) {
      return;
    }

    hasLoggedBootstrapValidationFailure = true;

    logger.error("Launch configuration validation failed during instrumentation bootstrap", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function _resetInstrumentationForTesting() {
  hasLoggedBootstrapValidationFailure = false;
}
