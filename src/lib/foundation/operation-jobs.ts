import "server-only";
import { z } from "zod";
import { createFoundationServiceApi, type FoundationServiceApi } from "./service-api";
import { sendPlatformNotice, type PlatformNoticeKind } from "../services/email";
const kind = z.enum([
  "payment_completed",
  "payment_reversed",
  "payment_reconciliation_required",
  "trial_started",
  "post_expired",
  "post_expiry_reminder",
  "draft_deletion_warning",
  "post_deleted",
  "verification_phone_confirmed",
  "identity_accepted",
  "enquiry_received",
]);
const jobs = z
  .array(
    z.object({
      id: z.uuid(),
      kind,
      claim_token: z.uuid(),
      locked_until: z.iso.datetime({ offset: true }),
      recipient: z.email().nullable(),
    })
  )
  .max(1);
type Delivery = (
  recipient: string,
  event: PlatformNoticeKind,
  key: string
) => Promise<{ success: boolean }>;
export async function runFoundationOperationJobs(
  service: FoundationServiceApi = createFoundationServiceApi(),
  deliver: Delivery = sendPlatformNotice
) {
  for (const [name, args] of [
    ["run_post_lifecycle", { p_limit: 100 }],
    ["sweep_sponsorships", { p_limit: 100 }],
    ["purge_expired_inbox", { p_limit: 100 }],
    ["reconcile_intro_trials", { p_limit: 20 }],
  ] as const) {
    const result = await service.rpc(name, args);
    if (result.error) throw new Error("A scheduled foundation transaction failed");
  }
  const claimed = await service.rpc("claim_notification_outbox", { p_limit: 1 });
  if (claimed.error) throw new Error("Notification jobs could not be claimed");
  const batch = jobs.parse(claimed.data);
  const result = { claimed: batch.length, succeeded: 0, retrying: 0 };
  for (const job of batch) {
    if (Date.parse(job.locked_until) <= Date.now()) {
      result.retrying++;
      continue;
    }
    let success = job.recipient === null;
    try {
      if (job.recipient)
        success = (await deliver(job.recipient, job.kind, `foundation-outbox/${job.id}`)).success;
    } catch {
      success = false;
    }
    const done = await service.rpc("complete_notification_outbox", {
      p_id: job.id,
      p_claim: job.claim_token,
      p_ok: success,
      p_error: success ? undefined : "delivery_failed",
    });
    if (done.error || done.data !== true || !success) result.retrying++;
    else result.succeeded++;
  }
  return result;
}
