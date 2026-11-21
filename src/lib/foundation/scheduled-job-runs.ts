import "server-only";

import type { FoundationServiceApi } from "./service-api";
import { createLogger } from "../utils/logger";

const log = createLogger("ScheduledJobRuns");

/** The timed jobs whose success the website decides: the payment status
 * check (every 10 minutes) and the daily Ozow refund check. Every other job's
 * database command records its own run
 * (20261120163500_staff_operations_health.sql). */
export type WebsiteRecordedJob = "payment_checks" | "refund_check";

/**
 * Records that `job` ran and succeeded, so the staff operations page does not
 * show it as late. Call it only after the whole run succeeded. Never throws:
 * a record that fails is logged (the page then shows the job as late), and
 * the run's own answer is unchanged. A database without the command (its
 * update not yet applied) is logged too.
 */
export async function recordScheduledJobRun(
  service: FoundationServiceApi,
  job: WebsiteRecordedJob
): Promise<boolean> {
  try {
    const rpc = service.rpc as unknown as (
      name: string,
      args: Record<string, unknown>
    ) => PromiseLike<{ error: { code?: string } | null }>;
    const { error } = await rpc("record_scheduled_job_run", { p_job: job });
    if (!error) return true;
    log.warn("Scheduled job run not recorded", { job, code: error.code ?? "unknown" });
  } catch {
    log.warn("Scheduled job run not recorded", { job, code: "request_failed" });
  }
  return false;
}
