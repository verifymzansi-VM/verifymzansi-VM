import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  postContactSelectionSchema,
  storedPostContactSelectionSchema,
} from "../domains/posts/contact-channels";

const id = z.uuid().transform((value) => value.toLowerCase());
const revision = z.number().int().min(1).max(2147483647);
const readRequest = z.strictObject({ id });
const saveRequest = z.strictObject({
  id,
  expected_revision: revision.max(2147483646),
  channels: postContactSelectionSchema,
});
const contacts = z
  .strictObject({
    id: z.uuid(),
    kind: z.enum(["listing", "event"]),
    status: z.enum([
      "draft",
      "pending_moderation",
      "live",
      "paused",
      "rejected",
      "expired",
      "sold",
      "archived",
    ]),
    revision,
    edit_of: z.uuid().nullable(),
    channels: storedPostContactSelectionSchema.nullable(),
    phone_ready: z.boolean(),
  })
  .refine((value) => value.edit_of !== value.id)
  .refine(
    (value) =>
      value.edit_of === null || ["draft", "pending_moderation", "rejected"].includes(value.status)
  )
  .refine((value) => value.kind === "listing" || value.status !== "sold");
const acknowledgement = z.strictObject({
  id: z.uuid(),
  revision,
  channels: storedPostContactSelectionSchema,
});

export function buildFoundationPostContacts(input: unknown) {
  const parsed = saveRequest.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation contact preferences");
  return {
    p_post_id: parsed.data.id,
    p_expected_revision: parsed.data.expected_revision,
    p_channels: parsed.data.channels,
  };
}

/** Current caller only. A missing/wrong-kind/foreign post returns null. */
export async function readFoundationPostContacts(api: FoundationAuthenticatedApi, input: unknown) {
  const request = readRequest.safeParse(input);
  if (!request.success) throw new Error("Invalid foundation contact preferences request");
  const { data, error } = await api
    .rpc("get_owner_post_contacts", {
      p_post_id: request.data.id,
    })
    .then(
      (value) => value,
      () => {
        throw new Error("Foundation contact preferences unavailable");
      }
    );
  if (error) throw new Error("Foundation contact preferences unavailable");
  if (data === null) return null;
  const parsed = contacts.safeParse(data);
  if (!parsed.success || parsed.data.id !== request.data.id)
    throw new Error("Invalid foundation contact preferences response");
  return parsed.data;
}

/** Explicit whole-post revision fence. Never replay an uncertain write. */
export async function saveFoundationPostContacts(api: FoundationAuthenticatedApi, input: unknown) {
  const command = buildFoundationPostContacts(input);
  const { data, error } = await api.rpc("set_post_contacts", command).then(
    (value) => value,
    () => {
      throw new Error("Foundation contact preferences unavailable");
    }
  );
  if (error) {
    if (error.code === "PT409")
      throw new Error("Foundation post changed; reload before saving contact preferences");
    throw new Error("Foundation contact preferences unavailable");
  }
  const parsed = acknowledgement.safeParse(data);
  if (
    !parsed.success ||
    parsed.data.id !== command.p_post_id ||
    parsed.data.revision !== command.p_expected_revision + 1 ||
    JSON.stringify(parsed.data.channels) !== JSON.stringify(command.p_channels)
  )
    throw new Error("Invalid foundation contact preferences response");
  return parsed.data;
}
