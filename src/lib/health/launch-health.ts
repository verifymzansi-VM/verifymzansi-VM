import {
  resolveLaunchValidationMode,
  validateLaunchConfiguration,
} from "@/lib/config/launch-validation";
import { checkCriticalEnvVars } from "@/lib/config/env";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("Health");
const AUDIT_FAILURE_DEGRADE_THRESHOLD = 5;

export interface HealthCheckStatus {
  status: "ok" | "degraded" | "skipped";
  detail?: string;
  errorCount?: number;
  warningCount?: number;
  failedChecks?: string[];
  warningChecks?: string[];
  failureCount?: number;
  failedDetails?: string[];
}

export interface LaunchHealthSnapshot {
  status: "ok" | "degraded";
  mode: ReturnType<typeof resolveLaunchValidationMode>;
  timestamp: string;
  checks: {
    config: HealthCheckStatus;
    criticalEnv: HealthCheckStatus;
    supabase: HealthCheckStatus;
    schema: HealthCheckStatus;
    r2: HealthCheckStatus;
    ozow: HealthCheckStatus;
    resend: HealthCheckStatus;
    africasTalking: HealthCheckStatus;
    turnstile: HealthCheckStatus;
    rateLimiter: HealthCheckStatus;
    audit: HealthCheckStatus;
  };
}

function envPresent(name: string): boolean {
  return typeof process.env[name] === "string" && process.env[name]!.trim().length > 0;
}

function missingEnvCheck(names: readonly string[]): string[] {
  return names.filter((name) => !envPresent(name));
}

function readinessFromEnv(names: readonly string[], detail: string): HealthCheckStatus {
  const missing = missingEnvCheck(names);
  if (missing.length > 0) {
    return {
      status: "degraded",
      detail: `Missing required readiness env: ${missing.join(", ")}`,
      failedChecks: [...missing],
    };
  }

  return {
    status: "ok",
    detail,
  };
}

function probeCriticalEnvVars(): HealthCheckStatus {
  try {
    const missing = checkCriticalEnvVars();
    if (missing.length > 0) {
      return {
        status: "degraded",
        detail: `Missing critical env vars: ${missing.join(", ")}`,
        failedChecks: [...missing],
      };
    }

    return {
      status: "ok",
      detail: "Critical env vars are present",
    };
  } catch {
    return {
      status: "skipped",
      detail: "Critical env var check is unavailable in this runtime",
    };
  }
}

async function probeSupabase(
  mode: ReturnType<typeof resolveLaunchValidationMode>
): Promise<HealthCheckStatus> {
  if (mode !== "production") {
    return {
      status: "skipped",
      detail: "Supabase launch probe is only enforced in production mode",
    };
  }

  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const supabase = createAdminClient();
    const { error } = await supabase.from("plans").select("area").limit(1);

    if (error) {
      logger.error("Supabase health probe failed", { code: error.code, message: error.message });
      return {
        status: "degraded",
        detail: "Supabase launch probe failed",
      };
    }

    return {
      status: "ok",
      detail: "Supabase query probe succeeded",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Supabase health probe threw", { error: message });
    return {
      status: "degraded",
      detail: "Supabase launch probe threw before completion",
    };
  }
}

async function getAuditHealth(): Promise<HealthCheckStatus> {
  try {
    const { getAuditFailureCount } = await import("@/lib/services/audit");
    const failureCount = getAuditFailureCount();
    return {
      status: failureCount < AUDIT_FAILURE_DEGRADE_THRESHOLD ? "ok" : "degraded",
      failureCount,
    };
  } catch {
    return {
      status: "skipped",
      detail: "Audit monitor unavailable in this runtime",
    };
  }
}

async function probeR2(
  mode: ReturnType<typeof resolveLaunchValidationMode>
): Promise<HealthCheckStatus> {
  if (mode !== "production") {
    return {
      status: "skipped",
      detail: "R2 readiness probe is only enforced in production mode",
    };
  }

  try {
    const { hasR2WriteAccess } = await import("@/lib/services/storage");
    const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";
    const writable = await hasR2WriteAccess(privateBucket);

    if (!writable) {
      return {
        status: "degraded",
        detail: "R2 private bucket write access is unavailable",
        failedChecks: ["R2 private bucket"],
      };
    }

    return {
      status: "ok",
      detail: "R2 private bucket write path is available",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("R2 readiness probe threw", { error: message });
    return {
      status: "degraded",
      detail: "R2 readiness probe threw before completion",
    };
  }
}

function probeOzow(mode: ReturnType<typeof resolveLaunchValidationMode>): HealthCheckStatus {
  if (mode !== "production") {
    return {
      status: "skipped",
      detail: "Ozow readiness probe is only enforced in production mode",
    };
  }

  const base = readinessFromEnv(
    ["OZOW_ENV", "OZOW_CLIENT_ID", "OZOW_CLIENT_SECRET", "OZOW_SITE_CODE", "OZOW_WEBHOOK_SECRET"],
    "Ozow required env is present"
  );
  if (base.status !== "ok") return base;

  const ozowEnv = process.env.OZOW_ENV;
  if (ozowEnv !== "production") {
    return {
      status: "degraded",
      detail: `OZOW_ENV must be production for production readiness, received ${ozowEnv}`,
      failedChecks: ["OZOW_ENV"],
    };
  }

  const configuredBaseUrl = process.env.OZOW_API_BASE_URL;
  if (configuredBaseUrl) {
    try {
      const parsed = new URL(configuredBaseUrl);
      if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "one.ozow.com") {
        return {
          status: "degraded",
          detail: "OZOW_API_BASE_URL must be https://one.ozow.com in production",
          failedChecks: ["OZOW_API_BASE_URL"],
        };
      }
    } catch {
      return {
        status: "degraded",
        detail: "OZOW_API_BASE_URL is not a valid URL",
        failedChecks: ["OZOW_API_BASE_URL"],
      };
    }
  }

  return {
    status: "ok",
    detail: "Ozow production env is present",
  };
}

function probeResend(mode: ReturnType<typeof resolveLaunchValidationMode>): HealthCheckStatus {
  if (mode !== "production") {
    return {
      status: "skipped",
      detail: "Resend readiness probe is only enforced in production mode",
    };
  }

  return readinessFromEnv(["RESEND_API_KEY"], "Resend API key is present");
}

function probeAfricasTalking(
  mode: ReturnType<typeof resolveLaunchValidationMode>
): HealthCheckStatus {
  if (mode !== "production") {
    return {
      status: "skipped",
      detail: "Africa's Talking readiness probe is only enforced in production mode",
    };
  }

  return readinessFromEnv(
    ["AFRICASTALKING_API_KEY", "AFRICASTALKING_USERNAME", "AFRICASTALKING_SENDER_ID"],
    "Africa's Talking OTP env is present"
  );
}

function probeTurnstile(mode: ReturnType<typeof resolveLaunchValidationMode>): HealthCheckStatus {
  if (mode !== "production") {
    return {
      status: "skipped",
      detail: "Turnstile readiness probe is only enforced in production mode",
    };
  }

  return readinessFromEnv(
    ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"],
    "Turnstile site and secret keys are present"
  );
}

async function probeRateLimiter(
  mode: ReturnType<typeof resolveLaunchValidationMode>
): Promise<HealthCheckStatus> {
  if (mode !== "production") {
    return {
      status: "skipped",
      detail: "Rate limiter readiness probe is only enforced in production mode",
    };
  }

  const base = readinessFromEnv(
    ["OTP_RATE_LIMITER_URL", "RATE_LIMITER_API_KEY"],
    "Shared rate limiter env is present"
  );
  if (base.status !== "ok") return base;

  let limiterUrl: URL;
  try {
    limiterUrl = new URL(process.env.OTP_RATE_LIMITER_URL!);
    if (limiterUrl.protocol !== "https:") {
      return {
        status: "degraded",
        detail: "OTP_RATE_LIMITER_URL must be HTTPS in production",
        failedChecks: ["OTP_RATE_LIMITER_URL"],
      };
    }
  } catch {
    return {
      status: "degraded",
      detail: "OTP_RATE_LIMITER_URL is not a valid URL",
      failedChecks: ["OTP_RATE_LIMITER_URL"],
    };
  }

  // Live authenticated probe: the app sends RATE_LIMITER_API_KEY while the
  // worker requires WORKER_API_KEY — a pairing mismatch 401s every call and
  // silently degrades the app to per-isolate limits. The worker checks the
  // bearer token before parsing the body, so a harmless read-only check
  // proves the shared secret matches on any non-401 response.
  const timeoutMs = Number(process.env.OTP_RATE_LIMITER_TIMEOUT_MS) || 2500;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(limiterUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.RATE_LIMITER_API_KEY}`,
        },
        body: JSON.stringify({
          key: "health:probe",
          action: "businesses:read",
          readOnly: true,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401) {
      return {
        status: "degraded",
        detail:
          "Rate limiter rejected RATE_LIMITER_API_KEY with 401 — it must match the worker's WORKER_API_KEY",
        failedChecks: ["RATE_LIMITER_API_KEY"],
      };
    }

    return {
      status: "ok",
      detail: "Shared rate limiter authenticated probe succeeded",
    };
  } catch (error) {
    // Network/timeout failures stay lenient so health does not flap on
    // transient worker unavailability.
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.warn("Rate limiter authenticated probe unreachable; skipping live check", {
      error: message,
    });
    return {
      status: "ok",
      detail: "Shared rate limiter env is present (live probe unreachable)",
    };
  }
}

/**
 * Probe critical tables to verify the database schema is intact.
 * Checks that core tables (plans, feature_flags, businesses) exist and are queryable.
 */
async function probeSchema(
  mode: ReturnType<typeof resolveLaunchValidationMode>
): Promise<HealthCheckStatus> {
  if (mode !== "production") {
    return {
      status: "skipped",
      detail: "Schema probe is only enforced in production mode",
    };
  }

  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const supabase = createAdminClient();

    const probes = [
      { table: "plans", select: "id" },
      { table: "feature_flags", select: "id" },
      { table: "businesses", select: "id" },
      {
        table: "account_profiles",
        select:
          "id, pending_phone, location_verified_at, legal_name_locked_at, contact_last_phone_change_at, contact_last_email_change_at, pending_email",
      },
    ] as const;
    const results = await Promise.all(
      probes.map(async (probe) => {
        const { error } = await supabase.from(probe.table).select(probe.select).limit(1);
        return { probe, error };
      })
    );

    const failures: string[] = [];
    for (const { probe, error } of results) {
      if (error) {
        failures.push(`${probe.table}: ${error.code ?? error.message}`);
      }
    }

    if (failures.length > 0) {
      logger.error("Schema probe found missing/broken tables", { failures });
      return {
        status: "degraded",
        detail: `Schema probe failures: ${failures.join("; ")}`,
        failedChecks: failures,
      };
    }

    return {
      status: "ok",
      detail: `All ${probes.length} critical schema probes verified`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Schema probe threw", { error: message });
    return {
      status: "degraded",
      detail: "Schema probe threw before completion",
    };
  }
}

export async function getLaunchHealthSnapshot(): Promise<LaunchHealthSnapshot> {
  const mode = resolveLaunchValidationMode(process.env);
  const configSummary = validateLaunchConfiguration(process.env, { mode });
  const [supabase, schema, r2, audit, rateLimiter] = await Promise.all([
    probeSupabase(mode),
    probeSchema(mode),
    probeR2(mode),
    getAuditHealth(),
    probeRateLimiter(mode),
  ]);
  const ozow = probeOzow(mode);
  const resend = probeResend(mode);
  const africasTalking = probeAfricasTalking(mode);
  const turnstile = probeTurnstile(mode);
  const criticalEnv = probeCriticalEnvVars();

  const config: HealthCheckStatus = {
    status: configSummary.isValid ? "ok" : "degraded",
    errorCount: configSummary.errors.length,
    warningCount: configSummary.warnings.length,
    failedChecks: configSummary.errors.map((check) => check.name),
    warningChecks: configSummary.warnings.map((check) => check.name),
    failedDetails: configSummary.errors.map((check) => `${check.name}: ${check.detail}`),
  };

  const degraded =
    config.status === "degraded" ||
    criticalEnv.status === "degraded" ||
    audit.status === "degraded" ||
    schema.status === "degraded" ||
    r2.status === "degraded" ||
    ozow.status === "degraded" ||
    resend.status === "degraded" ||
    africasTalking.status === "degraded" ||
    turnstile.status === "degraded" ||
    rateLimiter.status === "degraded" ||
    (mode === "production" && supabase.status === "degraded");

  return {
    status: degraded ? "degraded" : "ok",
    mode,
    timestamp: new Date().toISOString(),
    checks: {
      config,
      criticalEnv,
      supabase,
      schema,
      r2,
      ozow,
      resend,
      africasTalking,
      turnstile,
      rateLimiter,
      audit,
    },
  };
}
