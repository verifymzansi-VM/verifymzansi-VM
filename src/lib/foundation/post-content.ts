import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { postKindSchema } from "../domains/posts/identity";

const unsafeContent =
  /[\u0000-\u0008\u000b-\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069\ufeff]/u;
const unsafeLocality = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u;
const key = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,79}$/)
  .nullable()
  .optional();
const text = (maximum: number, unsafe: RegExp, beforeTrim = true) =>
  z
    .string()
    .refine((value) => !unsafe.test(beforeTrim ? value : value.trim()))
    .transform((value) => value.trim())
    .pipe(z.string().refine((value) => value.length <= maximum))
    .transform((value) => value || null)
    .nullable()
    .optional();
const envelope = z.strictObject({
  id: z.uuid().transform((value) => value.toLowerCase()),
  expected_revision: z.number().int().min(1).max(2147483646),
  kind: postKindSchema,
  content: z.unknown(),
});
const acknowledgement = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().min(2).max(2147483647),
});

/** Sparse patch: omitted values stay unchanged; explicit null clears them.
 * Kind selects client text bounds only. SQL derives real kind/owner/state.
 */
export function buildFoundationPostContent(input: unknown) {
  try {
    const value = envelope.parse(input);
    const parsed = z
      .strictObject({
        title: text(value.kind === "event" ? 120 : 100, unsafeContent),
        description: text(value.kind === "business" ? 3000 : 5000, unsafeContent),
        province_id: key,
        city_id: key,
        locality_label: text(80, unsafeLocality, false),
      })
      .parse(value.content);
    const content = Object.fromEntries(
      Object.entries(parsed).filter(([, entry]) => entry !== undefined)
    );
    if (
      Object.keys(content).length === 0 ||
      (content.city_id != null && content.locality_label != null)
    )
      throw new Error();
    const sqlJson = `{${Object.entries(content)
      .map(([name, entry]) => `${JSON.stringify(name)}: ${JSON.stringify(entry)}`)
      .join(", ")}}`;
    if (new TextEncoder().encode(sqlJson).length > 12000) throw new Error();
    return {
      p_post_id: value.id,
      p_expected_revision: value.expected_revision,
      p_content: content,
    };
  } catch {
    throw new Error("Invalid foundation post content request");
  }
}

/** One revision-fenced write. Never retry automatically after an uncertain reply. */
export async function saveFoundationPostContent(api: FoundationAuthenticatedApi, input: unknown) {
  const command = buildFoundationPostContent(input);
  const { data, error } = await api.rpc("save_post_content", command);
  if (error) {
    if (error.code === "PT409") throw new Error("Foundation post changed; reload before saving");
    throw new Error("Foundation post content unavailable");
  }
  const parsed = acknowledgement.safeParse(data);
  if (
    !parsed.success ||
    parsed.data.id !== command.p_post_id ||
    parsed.data.revision !== command.p_expected_revision + 1
  )
    throw new Error("Invalid foundation post content response");
  return parsed.data;
}
