import "server-only";

import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { hasDatabaseMessage, hasDatabaseReason } from "./error-reasons";

/**
 * The version of the switch wording on the communication page. Every saved
 * choice records it, so the record shows what the member agreed to. Change it
 * whenever a switch's label or description changes: the test of this file
 * compares COMMUNICATION_WORDING_SHA256 with the page's wording and fails
 * until both are updated together.
 */
export const COMMUNICATION_WORDING_VERSION = "communication-2026-11";
/** SHA-256 (base64url) of the four switches' labels and descriptions (see the test). */
export const COMMUNICATION_WORDING_SHA256 = "MkPrw-j1TTgkOkvREpa8Fm5FgB33C-9HqzFk-xMQVRs";

/** The member's four optional choices. Each is off until turned on. */
export const communicationChoicesSchema = z.strictObject({
  marketing_email: z.boolean(),
  marketing_sms: z.boolean(),
  analytics: z.boolean(),
  third_party_sharing: z.boolean(),
});
export type CommunicationChoices = z.infer<typeof communicationChoicesSchema>;

/** A change from the page: one or more choices, nothing else. */
export const communicationChoiceUpdateSchema = communicationChoicesSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);

const emailHistorySchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.uuid(),
        kind: z.string().regex(/^[a-z_]{1,80}$/),
        status: z.enum(["sent", "failed"]),
        at: z.iso.datetime({ offset: true }),
      })
    )
    .max(50),
});

/** One finished account email in the shape the restored page reads. */
export type RestoredEmailActivityItem = {
  id: string;
  action: "communication_email_sent" | "communication_email_failed";
  created_at: string;
  metadata: { template: string };
};

export class FoundationCommunicationError extends Error {
  override name = "FoundationCommunicationError";
  constructor(
    readonly reason: "invalid" | "limited" | "session" | "restricted" | "forbidden" | "unavailable"
  ) {
    super(reason);
  }
}

function refused(
  error: { code?: string | null; details?: string | null; message?: string | null } | null
): never {
  if (error?.code === "PT429" && hasDatabaseReason(error, "choice_limit"))
    throw new FoundationCommunicationError("limited");
  if (error?.code === "22023" && hasDatabaseReason(error, "choice_invalid"))
    throw new FoundationCommunicationError("invalid");
  if (error?.code === "42501") {
    // The session ended (or the account is no longer a signed-in, confirmed
    // member): sign in again.
    if (
      hasDatabaseMessage(error, "liveSessionRequired") ||
      hasDatabaseMessage(error, "signedInMemberRequired")
    )
      throw new FoundationCommunicationError("session");
    // A restricted account: turning a choice on needs an active account
    // (reading, withdrawing and, from 20261113223806, the email history do not).
    if (hasDatabaseMessage(error, "activeMemberRequired"))
      throw new FoundationCommunicationError("restricted");
    throw new FoundationCommunicationError("forbidden");
  }
  throw new FoundationCommunicationError("unavailable");
}

function parsed<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new FoundationCommunicationError("unavailable");
  return result.data;
}

/** The caller's own choices (the database answers only for the caller). */
export async function readCommunicationChoices(
  api: FoundationAuthenticatedApi
): Promise<CommunicationChoices> {
  const { data, error } = await api.rpc("get_my_communication_choices");
  if (error) refused(error);
  return parsed(communicationChoicesSchema, data);
}

/** Saves the given choices for the caller; returns all four afterwards. */
export async function saveCommunicationChoices(
  api: FoundationAuthenticatedApi,
  input: unknown
): Promise<CommunicationChoices> {
  const change = communicationChoiceUpdateSchema.safeParse(input);
  if (!change.success) throw new FoundationCommunicationError("invalid");
  const { data, error } = await api.rpc("save_my_communication_choices", {
    p_wording: COMMUNICATION_WORDING_VERSION,
    ...(change.data.marketing_email === undefined
      ? {}
      : { p_marketing_email: change.data.marketing_email }),
    ...(change.data.marketing_sms === undefined
      ? {}
      : { p_marketing_sms: change.data.marketing_sms }),
    ...(change.data.analytics === undefined ? {} : { p_analytics: change.data.analytics }),
    ...(change.data.third_party_sharing === undefined
      ? {}
      : { p_third_party_sharing: change.data.third_party_sharing }),
  });
  if (error) refused(error);
  return parsed(communicationChoicesSchema, data);
}

/** The caller's own finished account emails, newest first. */
export async function readEmailHistory(
  api: FoundationAuthenticatedApi,
  limit = 20
): Promise<RestoredEmailActivityItem[]> {
  const { data, error } = await api.rpc("list_my_email_history", { p_limit: limit });
  if (error) refused(error);
  return parsed(emailHistorySchema, data).items.map((item) => ({
    id: item.id,
    action: item.status === "sent" ? "communication_email_sent" : "communication_email_failed",
    created_at: item.at,
    metadata: { template: item.kind },
  }));
}
