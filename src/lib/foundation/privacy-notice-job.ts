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
/** `signal` cuts the database calls off at the job run's deadline; `canSend`
 * says whether a worst-case send still fits once the notice is claimed. */
export interface PrivacyNoticeRun {
  signal?: AbortSignal;
  canSend?: () => boolean;
}
export async function runFoundationPrivacyNotice(
  service: FoundationServiceApi,
  run: PrivacyNoticeRun = {}
) {
  const claim = service.rpc("claim_frontend_privacy_notice", {}, { get: false });
  const { data, error } = await (run.signal ? claim.abortSignal(run.signal) : claim);
  if (error) throw new Error("Privacy notice claim failed");
  if (data === null) return "empty" as const;
  const job = jobSchema.parse(data);
  if (Date.parse(job.locked_until) <= Date.now()) return "retrying" as const;
  const reference = `DSAR-${job.request_id.slice(0, 8).toUpperCase()}`;
  const key = `foundation-privacy/${job.id}`;
  let delivered = false;
  // Too late to send in this run: give the notice back for a later retry.
  if (run.canSend && !run.canSend()) return complete(job, false, service, run.signal);
  try {
    let result;
    switch (job.kind) {
      case "submitted":
        result = await sendDsarSubmissionEmail(job.recipient, reference, job.due!, key);
        break;
      case "extended":
        result = await sendDsarExtensionEmail(job.recipient, reference, job.due!, job.reason!, key);
        break;
      case "completed":
        result = await sendDsarCompletedEmail(job.recipient, reference, undefined, key);
        break;
      case "rejected":
        result = await sendDsarRejectedEmail(job.recipient, reference, undefined, key);
        break;
    }
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
  return !result.error && result.data === true && delivered
    ? ("succeeded" as const)
    : ("retrying" as const);
}
