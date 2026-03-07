let hasLoggedBootstrapValidationFailure = false;

export async function register() {
  const [{ validateEnv }, { createLogger }] = await Promise.all([
    import("./lib/config/env"),
    import("./lib/utils/logger"),
  ]);

  try {
    validateEnv();
  } catch (error) {
    // Surface launch misconfiguration without taking down every route.
    // /api/health and feature-level env access still report the problem.
    if (hasLoggedBootstrapValidationFailure) {
      return;
    }

    hasLoggedBootstrapValidationFailure = true;

    const logger = createLogger("Instrumentation");
    logger.error("Launch configuration validation failed during instrumentation bootstrap", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function _resetInstrumentationForTesting() {
  hasLoggedBootstrapValidationFailure = false;
}
