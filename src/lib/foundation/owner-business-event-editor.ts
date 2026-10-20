import { z } from "zod";
import { foundationEventWindowSchema } from "./event-window-dto";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import reference from "../domains/taxonomy/reference.json";
import { foundationOwnerMediaSchema, hasValidOwnerMediaSlots } from "./owner-editor-media";

const key = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const boundedText = (maximum: number) => z.string().refine((value) => value.length <= maximum);
const content = (title: number, description: number) =>
  z.strictObject({
    title: boundedText(title)
      .refine((value) => value.length > 0)
      .nullable(),
    description: boundedText(description).nullable(),
    province_id: key.nullable(),
    city_id: key.nullable(),
    locality_label: boundedText(120)
      .refine((value) => value.length > 0)
      .nullable(),
  });
const base = z.strictObject({
  id: z.uuid(),
  category_key: key,
  activity_key: key.nullable(),
  // SQL reserves sold for listings.
  status: z.enum([
    "draft",
    "pending_moderation",
    "live",
    "paused",
    "rejected",
    "expired",
    "archived",
  ]),
  revision: z.number().int().min(1).max(2147483647),
  edit_of: z.uuid().nullable(),
  media: z.array(foundationOwnerMediaSchema).max(100),
});
const editor = z
  .discriminatedUnion("kind", [
    base.extend({
      kind: z.literal("business"),
      area: z.enum(["business", "tourism_events"]),
      content: content(100, 3000),
      event_window: z.null(),
    }),
    base.extend({
      kind: z.literal("event"),
      area: z.literal("tourism_events"),
      content: content(120, 5000),
      event_window: foundationEventWindowSchema,
    }),
  ])
  .refine((value) => value.edit_of !== value.id)
  .refine(
    (value) =>
      value.edit_of === null || ["draft", "pending_moderation", "rejected"].includes(value.status)
  )
  .refine((value) => hasValidOwnerMediaSlots(value.media))
  .refine((value) => {
    const category = reference.categories.find((row) => row.key === value.category_key);
    return (
      category?.kind === value.kind &&
      category.area === value.area &&
      (!category.activityRequired || value.activity_key !== null) &&
      (value.activity_key === null ||
        reference.activities.some(
          (row) => row.category === value.category_key && row.key === value.activity_key
        ))
    );
  });

/** Core metadata inspection only; not complete forms, mutation permission or byte access. */
export function parseFoundationBusinessEventEditor(input: unknown) {
  if (input === null) return null;
  const parsed = editor.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation business/event editor");
  return parsed.data;
}
export async function readFoundationBusinessEventEditor(
  api: FoundationAuthenticatedApi,
  input: unknown
) {
  const parsed = z
    .strictObject({ id: z.uuid().transform((value) => value.toLowerCase()) })
    .safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation business/event editor request");
  const { data, error } = await api.rpc("get_owner_business_event_editor", {
    p_post_id: parsed.data.id,
  });
  if (error) throw new Error("Foundation business/event editor unavailable");
  const result = parseFoundationBusinessEventEditor(data);
  if (result !== null && result.id !== parsed.data.id)
    throw new Error("Invalid foundation business/event editor");
  return result;
}
