import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { postEventInstantSchema } from "../domains/posts/identity";

const activity = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const window = z
  .strictObject({
    starts_at: postEventInstantSchema,
    ends_at: postEventInstantSchema,
    // SQL's reviewed timezone catalogue is authoritative; retain valid stored aliases.
    timezone: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_+./-]+$/),
  })
  .refine((value) => {
    const duration = Date.parse(value.ends_at) - Date.parse(value.starts_at);
    return duration > 0 && duration <= 90 * 86400000;
  });
const request = z.strictObject({
  id: z.uuid().transform((value) => value.toLowerCase()),
  expected_revision: z.number().int().min(1).max(2147483646),
  patch: z.strictObject({
    activity_key: activity.nullable().optional(),
    event_window: window.optional(),
  }),
});
const acknowledgement = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().min(2).max(2147483647),
});

/** Sparse context mutation. Only explicit null clears activity; windows are complete.
 * Kind, category, ownership and permission are derived and checked in SQL.
 */
export function buildFoundationBusinessEventContext(input: unknown) {
  try {
    const parsed = request.parse(input);
    const patch = Object.fromEntries(
      Object.entries(parsed.patch).filter(([, value]) => value !== undefined)
    );
    if (Object.keys(patch).length === 0) throw new Error();
    return { p_post_id: parsed.id, p_expected_revision: parsed.expected_revision, p_patch: patch };
  } catch {
    throw new Error("Invalid foundation business/event context request");
  }
}
/** One revision-fenced write. An uncertain reply must never trigger automatic retry. */
export async function saveFoundationBusinessEventContext(
  api: FoundationAuthenticatedApi,
  input: unknown
) {
  const command = buildFoundationBusinessEventContext(input);
  const { data, error } = await api.rpc("save_business_event_context", command);
  if (error) {
    if (error.code === "PT409") throw new Error("Foundation post changed; reload before saving");
    throw new Error("Foundation business/event context unavailable");
  }
  const parsed = acknowledgement.safeParse(data);
  if (
    !parsed.success ||
    parsed.data.id !== command.p_post_id ||
    parsed.data.revision !== command.p_expected_revision + 1
  )
    throw new Error("Invalid foundation business/event context response");
  return parsed.data;
}
