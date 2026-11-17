import "server-only";
import { z } from "zod";
import type { FoundationServiceApi } from "./service-api";
import {
  sendDsarCompletedEmail,
  sendDsarExtensionEmail,
  sendDsarRejectedEmail,
  sendDsarSubmissionEmail,
} from "../services/email";

const date = z.iso.datetime({ offset: true });
const jobSchema = z
  .strictObject({
    id: z.uuid(),
    request_id: z.uuid(),
    kind: z.enum(["submitted", "extended", "completed", "rejected"]),
    recipient: z.email(),
    claim_token: z.uuid(),
    locked_until: date,
    due: date.nullable(),
    reason: z.string().min(10).max(1000).nullable(),
  })
  .refine(
    (j) =>
      Boolean(j.due) === (j.kind === "extended" || j.kind === "submitted") &&
      Boolean(j.reason) === (j.kind === "extended")
  );
/** Limits from the job run. `claimSignal` cuts the claim off early enough
 * that a claimed notice can still be sent (a claim uses up one of the
 * notice's attempts); `signal` cuts the other database calls off at the run's
 * deadline; `canSend` says whether a worst-case send still fits; `pace`
 * spaces the send from the run's other sends. */
export interface PrivacyNoticeRun {
  claimSignal?: AbortSignal;
  signal?: AbortSignal;
  canSend?: () => boolean;
  pace?: <T>(send: () => Promise<T>) => Promise<T>;
}
export async function runFoundationPrivacyNotice(
  service: FoundationServiceApi,
  run: PrivacyNoticeRun = {}
) {
  const claimSignal = run.claimSignal ?? run.signal;
  const claim = service.rpc("claim_frontend_privacy_notice", {}, { get: false });
  const { data, error } = await (claimSignal ? claim.abortSignal(claimSignal) : claim);
  if (error) throw new Error("Privacy notice claim failed");
  if (data === null) return "empty" as const;
  const job = jobSchema.parse(data);
  if (Date.parse(job.locked_until) <= Date.now()) return "retrying" as const;
  const reference = `DSAR-${job.request_id.slice(0, 8).toUpperCase()}`;
  const key = `foundation-privacy/${job.id}`;
  let delivered = false;
  // Too late to send in this run: give the notice back for a later retry.
  if (run.canSend && !run.canSend()) return complete(job, false, service, run.signal);
  const pace = run.pace ?? (<T>(send: () => Promise<T>) => send());
  try {
    const result = await pace(() => {
      switch (job.kind) {
        case "submitted":
          return sendDsarSubmissionEmail(job.recipient, reference, job.due!, key);
        case "extended":
          return sendDsarExtensionEmail(job.recipient, reference, job.due!, job.reason!, key);
        case "completed":
          return sendDsarCompletedEmail(job.recipient, reference, undefined, key);
        case "rejected":
          return sendDsarRejectedEmail(job.recipient, reference, undefined, key);
      }
    });
    delivered = result.success;
  } catch {
    delivered = false;
  }
  return complete(job, delivered, service, run.signal);
}

async function complete(
  job: { id: string; claim_token: string },
  delivered: boolean,
  service: FoundationServiceApi,
  signal?: AbortSignal
) {
  const call = service.rpc("complete_frontend_privacy_notice", {
    p_job: job.id,
    p_claim: job.claim_token,
    p_delivered: delivered,
  });
  const result = await (signal ? call.abortSignal(signal) : call);
  // A lost lease (`false`) is retried later; an error means the outcome
  // could not be recorded, which the run reports.
  if (result.error) throw new Error("Privacy notice outcome could not be recorded");
  return result.data === true && delivered ? ("succeeded" as const) : ("retrying" as const);
}
