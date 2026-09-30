import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthAdminUserSummary } from "@/lib/supabase/auth-admin-user";
import { createLogger } from "@/lib/utils/logger";
import {
  sendDsarExtensionEmail,
  sendModerationNoticeEmail,
  type ModerationNoticeTemplate,
} from "@/lib/services/email";
import { logAuditEvent } from "@/lib/services/audit";

const log = createLogger("OperationJobs");

/**
 * Durable jobs for effects outside PostgreSQL. Decisions enqueue them in the
 * same transaction that commits the decision (operation_jobs); this runner
 * claims due jobs, performs them, and reports back. Failures retry with
 * backoff and become `dead` (with a critical ops_event) after the maximum
 * attempts; an admin can retry a dead job.
 *
 * Every handler must be safe to repeat: a job can run again if the runner
 * stops between doing the work and reporting it.
 */

interface OperationJob {
  id: string;
  kind: "email_notice" | "auth_metadata_sync" | "storage_delete";
  payload: Record<string, unknown>;
  attempts: number;
  locked_until: string;
  decision_id: string | null;
}

const NOTICE_TEMPLATES = new Set<ModerationNoticeTemplate>([
  "account_warn",
  "account_suspend",
  "account_ban",
  "content_hidden",
  "restriction_lifted",
  "appeal_upheld",
  "appeal_dismissed",
  "appeal_overturned",
  "appeal_partially_overturned",
]);

const str = (value: unknown) => (typeof value === "string" && value ? value : null);

/** Written notice of a DSAR deadline extension, then record that it was sent. */
async function sendDsarExtensionNotice(job: OperationJob): Promise<void> {
  const caseId = str(job.payload.case_id);
  const email = str(job.payload.email);
  const due = str(job.payload.due);
  const reason = str(job.payload.reason);
  if (!caseId || !email || !due || !reason) throw new Error("Unusable DSAR extension payload");

  const admin = createAdminClient();
  const { data: current, error: readError } = await admin
    .from("dsar_cases")
    .select("extension_notified_at")
    .eq("id", caseId)
    .maybeSingle();
  if (readError) throw new Error(`Could not read the case: ${readError.message}`);
  if (!current) throw new Error("Data request case no longer exists");
  // Already sent on an earlier attempt: never email the requester twice.
  if (current?.extension_notified_at) return;

  const result = await sendDsarExtensionEmail(
    email,
    `DSAR-${caseId.slice(0, 8).toUpperCase()}`,
    due,
    reason,
    `operation-job/${job.id}`
  );
  if (!result.success) throw new Error(result.error ?? "Email provider refused the notice");

  const { data: recorded, error } = await admin
    .from("dsar_cases")
    .update({ extension_notified_at: new Date().toISOString() })
    .eq("id", caseId)
    .select("id")
    .maybeSingle();
  if (error || !recorded) {
    // Retry with the same provider key so a temporary database failure does
    // not permanently leave the requester notice unrecorded. Resend dedupes
    // this key for 24 hours; delayed/manual retries can still resend the email.
    throw new Error(
      `DSAR extension notice sent but not recorded: ${error?.message ?? "case not updated"}`
    );
  }
}

async function sendNotice(job: OperationJob): Promise<void> {
  const template = str(job.payload.template);
  if (template === "dsar_extension") return sendDsarExtensionNotice(job);
  const userId = str(job.payload.user_id);
  const decisionId = str(job.payload.decision_id) ?? job.decision_id;
  if (
    !template ||
    !NOTICE_TEMPLATES.has(template as ModerationNoticeTemplate) ||
    !userId ||
    !decisionId
  ) {
    throw new Error(`Unusable notice payload (template ${template ?? "missing"})`);
  }

  const admin = createAdminClient();
  const recipient = await getAuthAdminUserSummary(admin, userId);
  if (recipient.errorMessage) {
    // An unavailable auth service is not proof that the account has no email.
    // Keep the notice queued so the normal job backoff can recover delivery.
    throw new Error(`Could not look up notice recipient: ${recipient.errorMessage}`);
  }
  if (!recipient.email) {
    // Deleted accounts or accounts without email: nothing to send.
    log.info("Notice skipped: no email address", { jobId: job.id, template });
    return;
  }

  const result = await sendModerationNoticeEmail({
    email: recipient.email,
    accountName: recipient.accountName,
    template: template as ModerationNoticeTemplate,
    reason: str(job.payload.reason) ?? str(job.payload.rationale),
    endsAt: str(job.payload.suspended_until),
    decisionId,
    idempotencyKey: `operation-job/${job.id}`,
  });

  await logAuditEvent({
    actorId: "00000000-0000-0000-0000-000000000000",
    actorRole: "system",
    action: result.success ? "communication_email_sent" : "communication_email_failed",
    targetType: "account_profile",
    targetId: userId,
    metadata: {
      template,
      channel: "email",
      job_id: job.id,
      decision_id: decisionId,
      error: result.error,
    },
  });
  if (!result.success) throw new Error(result.error ?? "Email provider refused the notice");
}

async function syncAuthMetadata(job: OperationJob): Promise<void> {
  const userId = str(job.payload.user_id);
  if (!userId) throw new Error("Unusable metadata payload");

  // Write the role as it is now, not as it was when the job was queued, so a
  // late retry never restores an older role over a newer change.
  const admin = createAdminClient();
  const { data: staff, error: staffError } = await admin
    .from("staff_roles")
    .select("role, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (staffError) throw new Error(`Could not read the current role: ${staffError.message}`);
  const role = staff?.status === "active" ? staff.role : "member";

  const { data, error: readError } = await admin.auth.admin.getUserById(userId);
  if (readError || !data?.user) throw new Error(readError?.message ?? "User not found");
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { ...data.user.app_metadata, role },
  });
  if (error) throw new Error(error.message);
}

const HANDLERS: Record<OperationJob["kind"], (job: OperationJob) => Promise<void>> = {
  email_notice: sendNotice,
  auth_metadata_sync: syncAuthMetadata,
  storage_delete: async () => {
    throw new Error("No storage deletion handler is configured yet");
  },
};

export interface RunSummary {
  claimed: number;
  succeeded: number;
  retrying: number;
  dead: number;
}

/** Claim and run up to `limit` due jobs. */
export async function runOperationJobs(limit = 20): Promise<RunSummary> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_operation_jobs", { p_limit: limit });
  if (error) throw new Error(`Could not claim jobs: ${error.message}`);

  const jobs = (data ?? []) as OperationJob[];
  const summary: RunSummary = { claimed: jobs.length, succeeded: 0, retrying: 0, dead: 0 };

  for (const job of jobs) {
    // Sequential batches can outlive the lease of their later jobs. Leave those
    // effects for a fresh claim instead of starting work with stale ownership.
    if (!job.locked_until || Date.parse(job.locked_until) <= Date.now()) {
      log.warn("Operation job lease expired before execution", { jobId: job.id });
      continue;
    }
    let failure: string | null = null;
    try {
      await HANDLERS[job.kind](job);
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      log.warn("Operation job failed", {
        jobId: job.id,
        kind: job.kind,
        attempt: job.attempts,
        error: failure,
      });
    }

    const { data: outcome, error: completeError } = await admin.rpc("complete_operation_job", {
      p_job: job.id,
      p_ok: failure === null,
      p_error: failure,
      p_attempt: job.attempts,
      p_locked_until: job.locked_until,
    });
    if (completeError) {
      // The lock expires and the job is claimed again; handlers are idempotent.
      log.error("Could not record job outcome", { jobId: job.id, error: completeError.message });
      continue;
    }
    if (outcome === "succeeded") summary.succeeded += 1;
    else if (outcome === "dead") summary.dead += 1;
    else if (outcome === "retrying") summary.retrying += 1;
    else {
      log.warn("Operation job claim was superseded", { jobId: job.id, attempt: job.attempts });
    }
  }

  return summary;
}
