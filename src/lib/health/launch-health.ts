import {
  resolveLaunchValidationMode,
  validateLaunchConfiguration,
} from "@/lib/config/launch-validation";
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
}

export interface LaunchHealthSnapshot {
  status: "ok" | "degraded";
  mode: ReturnType<typeof resolveLaunchValidationMode>;
  timestamp: string;
  checks: {
    config: HealthCheckStatus;
    supabase: HealthCheckStatus;
    audit: HealthCheckStatus;
  };
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

export async function getLaunchHealthSnapshot(): Promise<LaunchHealthSnapshot> {
  const mode = resolveLaunchValidationMode(process.env);
  const configSummary = validateLaunchConfiguration(process.env, { mode });
  const supabase = await probeSupabase(mode);
  const audit = await getAuditHealth();

  const config: HealthCheckStatus = {
    status: configSummary.isValid ? "ok" : "degraded",
    errorCount: configSummary.errors.length,
    warningCount: configSummary.warnings.length,
    failedChecks: configSummary.errors.map((check) => check.name),
    warningChecks: configSummary.warnings.map((check) => check.name),
  };

  const degraded =
    config.status === "degraded" ||
    audit.status === "degraded" ||
    (mode === "production" && supabase.status === "degraded");

  return {
    status: degraded ? "degraded" : "ok",
    mode,
    timestamp: new Date().toISOString(),
    checks: {
      config,
      supabase,
      audit,
    },
  };
}
