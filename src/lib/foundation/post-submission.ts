import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const request = z.strictObject({
  id: z.uuid().transform((value) => value.toLowerCase()),
  expected_revision: z.number().int().min(1).max(2147483646),
});
const acknowledgement = z.strictObject({
  id: z.uuid(),
  status: z.literal("pending_moderation"),
  revision: z.number().int().min(2).max(2147483647),
});

export function buildFoundationPostSubmission(input: unknown) {
  const parsed = request.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation post submission request");
  return { p_post_id: parsed.data.id, p_expected_revision: parsed.data.expected_revision };
}

/** One caller-bound, revision-fenced command. Never replay an uncertain write. */
export async function submitFoundationPost(api: FoundationAuthenticatedApi, input: unknown) {
  const command = buildFoundationPostSubmission(input);
  const { data, error } = await api.rpc("submit_post", command).then(
    (response) => response,
    () => {
      throw new Error("Foundation post submission unavailable");
    }
  );
  if (error) {
    if (error.code === "42501" && error.details === "posting_verification_required")
      throw new Error("Complete identity, phone and locality verification before submitting");
    if (error.code === "22023" && error.details === "contact_channels_required")
      throw new Error("Choose at least one contact method before submitting");
    if (error.code === "PT409" && error.details === "contact_phone_required")
      throw new Error("Verify your account phone before using Call or WhatsApp");
    if (error.code === "PT409" && error.details === "duplicate_event")
      throw new Error(
        "A matching event is already pending or live on your account; edit that event instead"
      );
    if (error.code === "PT409")
      throw new Error("Foundation post changed; reload before submitting");
    if (error.code === "PT429") throw new Error("Foundation posting allowance reached");
    throw new Error("Foundation post submission unavailable");
  }
  const parsed = acknowledgement.safeParse(data);
  if (
    !parsed.success ||
    parsed.data.id !== command.p_post_id ||
    parsed.data.revision !== command.p_expected_revision + 1
  )
    throw new Error("Invalid foundation post submission response");
  return parsed.data;
}
