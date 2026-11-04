import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
const rows = z
  .array(
    z.strictObject({
      object_id: z.uuid(),
      object_key: z.string().regex(/^media\/[a-f0-9-]{36}$/),
      kind: z.enum(["image", "video"]),
      state: z.literal("ready"),
    })
  )
  .max(80);
export class OwnedMediaError extends Error {
  constructor(
    readonly status: 403 | 422 | 503,
    message: string
  ) {
    super(message);
  }
}
/** Public keys and private object IDs are independent opaque identifiers. Only
 * a live owner's closed RPC may bind them; URL suffixes never grant ownership. */
export async function resolveOwnedMedia(
  api: FoundationAuthenticatedApi,
  input: { keys?: string[]; ids?: string[] }
) {
  const keys = [...new Set(input.keys ?? [])],
    ids = [...new Set((input.ids ?? []).map((id) => z.uuid().parse(id).toLowerCase()))];
  if (keys.length + ids.length > 80) throw new Error("Too many media references");
  if (!keys.length && !ids.length) return [];
  const result = await api.rpc(
    "resolve_my_frontend_media",
    { ...(keys.length ? { p_keys: keys } : {}), ...(ids.length ? { p_ids: ids } : {}) },
    { get: false }
  );
  if (result.error)
    throw new OwnedMediaError(
      result.error.code === "42501" ? 403 : result.error.code === "22023" ? 422 : 503,
      "An upload is unavailable. Refresh your post or upload the file again before submitting."
    );
  const resolved = rows.parse(result.data);
  if (
    keys.some((key) => !resolved.some((m) => m.object_key === key)) ||
    ids.some((id) => !resolved.some((m) => m.object_id === id)) ||
    resolved.some((m) => !keys.includes(m.object_key) && !ids.includes(m.object_id)) ||
    new Set(resolved.map((m) => m.object_id)).size !== resolved.length
  )
    throw new Error("Owned media resolution changed");
  return resolved;
}
