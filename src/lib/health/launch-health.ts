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
  failedDetails?: string[];
}

export interface LaunchHealthSnapshot {
  status: "ok" | "degraded";
  mode: ReturnType<typeof resolveLaunchValidationMode>;
  timestamp: string;
  checks: {
    config: HealthCheckStatus;
    supabase: HealthCheckStatus;
    schema: HealthCheckStatus;
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
  const [supabase, schema, audit] = await Promise.all([
    probeSupabase(mode),
    probeSchema(mode),
    getAuditHealth(),
  ]);

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
    audit.status === "degraded" ||
    schema.status === "degraded" ||
    (mode === "production" && supabase.status === "degraded");

  return {
    status: degraded ? "degraded" : "ok",
    mode,
    timestamp: new Date().toISOString(),
    checks: {
      config,
      supabase,
      schema,
      audit,
    },
  };
}
