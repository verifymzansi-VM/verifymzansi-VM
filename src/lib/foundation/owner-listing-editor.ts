import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { listingPriceCategorySchema } from "../domains/listings/price-terms";
import { emptyListingPriceForm, restoreListingPriceForm } from "../domains/listings/price-form";
import { parseListingAttributeDraft } from "../domains/taxonomy/attributes";
import { readCoreDraft } from "../domains/posts/identity";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const key = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const dimension = z.number().int().min(1).max(20000).nullable();
const media = z
  .strictObject({
    object_id: z.uuid(),
    kind: z.enum(["image", "video"]),
    state: z.enum(["intent", "ready", "rejected", "cleanup_required", "deleted"]),
    purpose: z.enum(["cover", "gallery", "logo", "video"]),
    position: z.number().int().min(0).max(49),
    width: dimension,
    height: dimension,
    focal_x: z.number().min(0).max(1).nullable(),
    focal_y: z.number().min(0).max(1).nullable(),
  })
  .refine((item) => (item.purpose === "video") === (item.kind === "video"))
  .refine(
    (item) =>
      item.state !== "ready" ||
      item.kind !== "image" ||
      (item.width !== null && item.height !== null)
  );
const editor = z
  .strictObject({
    id: z.uuid(),
    kind: z.literal("listing"),
    area: z.literal("market"),
    category_key: listingPriceCategorySchema,
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
    revision: z.number().int().min(1).max(2147483647),
    edit_of: z.uuid().nullable(),
    content: z.strictObject({
      title: z.string().min(1).max(120).nullable(),
      description: z.string().max(5000).nullable(),
      province_id: key.nullable(),
      city_id: key.nullable(),
      locality_label: z.string().min(1).max(120).nullable(),
    }),
    terms: z.strictObject({
      price_mode: z.enum(["amount", "free", "on_request"]).nullable(),
      price_cents: z.number().int().min(0).max(9999999900).nullable(),
      price_negotiable: z.boolean(),
    }),
    attributes_version: z.literal(1),
    attributes: z.record(key, z.unknown()),
    media: z.array(media).max(100),
  })
  .refine((value) => value.edit_of !== value.id)
  .refine(
    (value) =>
      value.edit_of === null || ["draft", "pending_moderation", "rejected"].includes(value.status)
  )
  .refine((value) => {
    const items = value.media;
    return (
      new Set(items.map((item) => `${item.purpose}/${item.position}`)).size === items.length &&
      new Set(items.map((item) => `${item.purpose}/${item.object_id}`)).size === items.length &&
      items.filter((item) => item.purpose === "cover").length <= 1 &&
      items.filter((item) => item.purpose === "logo").length <= 1
    );
  });
const request = z.strictObject({ id: uuid });

/** Atomic owner restore only. Status is not permission to edit and metadata
 * grants no media byte/evidence access. SQL authorizes every later command.
 */
export function parseFoundationListingEditor(input: unknown) {
  if (input === null) return null;
  try {
    const value = editor.parse(input);
    if (new TextEncoder().encode(JSON.stringify(value.attributes)).length > 16384)
      throw new Error();
    const attributes = parseListingAttributeDraft(value.category_key, value.attributes);
    let priceForm;
    if (value.terms.price_mode === null) {
      if (value.terms.price_cents !== null || value.terms.price_negotiable) throw new Error();
      priceForm = emptyListingPriceForm();
    } else priceForm = restoreListingPriceForm(value.terms, value.category_key);
    return { ...value, attributes, price_form: priceForm };
  } catch {
    throw new Error("Invalid foundation listing editor");
  }
}
export type FoundationListingEditor = NonNullable<ReturnType<typeof parseFoundationListingEditor>>;
export async function readFoundationListingEditor(api: FoundationAuthenticatedApi, input: unknown) {
  const parsed = request.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation listing editor request");
  const { data, error } = await api.rpc("get_owner_listing_editor", { p_post_id: parsed.data.id });
  if (error) throw new Error("Foundation listing editor unavailable");
  const result = parseFoundationListingEditor(data);
  if (result !== null && result.id !== parsed.data.id)
    throw new Error("Invalid foundation listing editor");
  return result;
}

/** Creation has one acknowledgement, separate from later editor loading.
 * An uncertain response can follow a committed create; do not silently replay.
 */
export async function createFoundationListingDraft(
  api: FoundationAuthenticatedApi,
  input: unknown
) {
  const parsed = z.strictObject({ category: listingPriceCategorySchema }).safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation listing creation request");
  const { data, error } = await api.rpc("create_core_draft", {
    p_kind: "listing",
    p_area: "market",
    p_category_key: parsed.data.category,
    p_detail: {},
  });
  if (error) throw new Error("Foundation listing creation unavailable");
  try {
    const result = readCoreDraft(data);
    if (
      result.kind !== "listing" ||
      result.area !== "market" ||
      result.category_key !== parsed.data.category ||
      result.revision !== 1 ||
      result.activity_key !== undefined
    )
      throw new Error();
    return result;
  } catch {
    throw new Error("Invalid foundation listing creation response");
  }
}
