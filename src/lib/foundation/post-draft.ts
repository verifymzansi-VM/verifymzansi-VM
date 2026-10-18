import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { z } from "zod";
import { buildCoreDraftCommand, readCoreDraft } from "../domains/posts/identity";

/** Creates one identity acknowledgement. Further editor reads are explicit;
 * a failed or malformed reply can follow a committed create. Never auto-retry.
 */
export async function createFoundationPostDraft(api: FoundationAuthenticatedApi, input: unknown) {
  let command: ReturnType<typeof buildCoreDraftCommand>;
  try {
    command = buildCoreDraftCommand(input);
  } catch {
    throw new Error("Invalid foundation post creation request");
  }
  const { data, error } = await api.rpc("create_core_draft", command);
  if (error) throw new Error("Foundation post creation unavailable");
  try {
    const result = readCoreDraft(data);
    if (
      result.kind !== command.p_kind ||
      result.area !== command.p_area ||
      result.category_key !== command.p_category_key ||
      result.revision !== 1 ||
      result.activity_key !== command.p_activity_key
    )
      throw new Error();
    return result;
  } catch {
    throw new Error("Invalid foundation post creation response");
  }
}

/** Identity restore only, not a complete editor or a grant to mutate a post. */
export async function readFoundationPostDraft(api: FoundationAuthenticatedApi, input: unknown) {
  const request = z
    .strictObject({ id: z.uuid().transform((value) => value.toLowerCase()) })
    .safeParse(input);
  if (!request.success) throw new Error("Invalid foundation post draft request");
  const { data, error } = await api.rpc("get_core_draft", { p_id: request.data.id });
  if (error) throw new Error("Foundation post draft unavailable");
  if (data === null) return null;
  try {
    const result = readCoreDraft(data);
    if (result.id !== request.data.id) throw new Error();
    return result;
  } catch {
    throw new Error("Invalid foundation post draft response");
  }
}
