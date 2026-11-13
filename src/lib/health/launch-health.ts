import {
  resolveLaunchValidationMode,
  validateLaunchConfiguration,
} from "@/lib/config/launch-validation";
import { checkCriticalEnvVars } from "@/lib/config/env";
import { createLogger } from "@/lib/utils/logger";
import { verifyFoundationGateway } from "@/lib/foundation/gateway-readiness";

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
    missing.push(
      ...missingEnvCheck([
        "FOUNDATION_SUPABASE_URL",
        "FOUNDATION_PROJECT_REF",
        "FOUNDATION_SUPABASE_PUBLISHABLE_KEY",
        "FOUNDATION_SUPABASE_SECRET_KEY",
        "FOUNDATION_PHONE_OTP_KEY",
      ])
    );
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
  // bearer token before parsing the body. Require a successful read-only
  // response so outages and edge challenges cannot pass deployment readiness.
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

    if (!response.ok) {
      return {
        status: "degraded",
        detail: `Shared rate limiter probe returned HTTP ${response.status}`,
        failedChecks: ["Rate limiter availability"],
      };
    }

    const payload = await response.json();
    if (payload?.ok !== true) {
      return {
        status: "degraded",
        detail: "Shared rate limiter probe did not return a successful check",
        failedChecks: ["Rate limiter response"],
      };
    }

    return {
      status: "ok",
      detail: "Shared rate limiter authenticated probe succeeded",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.warn("Rate limiter authenticated probe unavailable", {
      error: message,
    });
    return {
      status: "degraded",
      detail: "Shared rate limiter live probe unreachable or invalid",
      failedChecks: ["Rate limiter availability"],
    };
  }
}

export async function getLaunchHealthSnapshot(): Promise<LaunchHealthSnapshot> {
  const mode = resolveLaunchValidationMode(process.env);
  const configSummary = validateLaunchConfiguration(process.env, { mode });
  const database = async (): Promise<[HealthCheckStatus, HealthCheckStatus]> => {
    if (mode !== "production")
      return [
        { status: "skipped", detail: "Supabase launch probe is only enforced in production mode" },
        { status: "skipped", detail: "Schema probe is only enforced in production mode" },
      ];
    try {
      await verifyFoundationGateway(process.env);
      return [
        { status: "ok", detail: "Foundation public read and service credential verified" },
        { status: "ok", detail: "Foundation function-only API and schema isolation verified" },
      ];
    } catch {
      return [
        { status: "degraded", detail: "Foundation gateway or credential check failed" },
        { status: "degraded", detail: "Foundation API readiness could not be verified" },
      ];
    }
  };
  const [[supabase, schema], r2, audit, rateLimiter] = await Promise.all([
    database(),
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
