import { z } from "zod";
import { CATEGORIES } from "@/lib/constants/categories";
import { DEFAULT_LISTING_CONTACT_METHODS, withListingEnquiry } from "@/lib/forms/listing-form";
import type { ListingDraftData } from "@/lib/post-drafts/storage";

/**
 * Post templates (business tools plan section 4, SHOW_POST_TEMPLATES): a
 * reusable starting point for Market listings. A template keeps the "Post an
 * item" form's fields the plan lists (the autosaved draft's shape, see
 * ListingDraftData), never photos, video, title, prices, numbers or the
 * details of one item. The database enforces the same rule
 * (api.save_my_post_template).
 */

export const POST_TEMPLATE_LIMIT = 20;
export const POST_TEMPLATE_NAME_MAX = 60;

/**
 * Details a template never keeps (the database refuses them too): prices, and
 * details that belong to one item, which the poster fills in each time.
 */
const PER_ITEM_DETAILS = new Set([
  // Prices
  "monthly_rent_zar",
  "salary_min",
  "salary_max",
  "levy_zar",
  "rates_taxes_zar",
  // One item
  "year",
  "mileage_km",
  "number_of_owners",
  "battery_health_pct",
  "colour",
  "accident_free",
  "registration_province",
  "available_from",
  "application_deadline",
  "age_months",
  "quantity",
]);
const CONTACT_BUTTONS = ["call", "whatsapp", "in_app"] as const;

/** Text the database can store: jsonb refuses the NUL character. */
const text = z.string().refine((value) => !value.includes("\u0000"));
const detailValue = z.union([text, z.boolean(), z.array(text)]);

/** A name as the database counts it: 1 to 60 characters (code points), trimmed. */
export const postTemplateName = z
  .string()
  .trim()
  .refine((name) => {
    const length = [...name].length;
    // No control characters, as the database's [[:cntrl:]] rule.
    return length >= 1 && length <= POST_TEMPLATE_NAME_MAX && !/\p{Cc}/u.test(name);
  });

export const postTemplateData = z.strictObject({
  category: text.pipe(z.string().min(1)),
  condition: text.optional(),
  categoryAttributes: z
    .record(text, detailValue)
    .refine((details) => Object.keys(details).every((key) => !PER_ITEM_DETAILS.has(key)))
    .optional(),
  description: text.optional(),
  province: text.optional(),
  city: text.optional(),
  town: text.optional(),
  address: text.optional(),
  contactMethods: z.array(z.enum(CONTACT_BUTTONS)).optional(),
});
export type PostTemplateData = z.infer<typeof postTemplateData>;

export const postTemplate = z.strictObject({
  id: z.uuid(),
  kind: z.literal("listing"),
  name: postTemplateName,
  data: postTemplateData,
  updated_at: z.string(),
});
export type PostTemplate = z.infer<typeof postTemplate>;

export type PostTemplateList = { package_running: boolean; templates: PostTemplate[] };

/**
 * The list answer, template by template: one that does not parse (saved
 * before a rule changed, say) is left out and named in `dropped`, so the rest
 * stay usable. Throws only when the answer itself is malformed.
 */
export function parsePostTemplateList(body: unknown): PostTemplateList & { dropped: number } {
  const list = z
    .strictObject({
      package_running: z.boolean(),
      templates: z.array(z.unknown()).max(POST_TEMPLATE_LIMIT),
    })
    .parse(body);
  const templates = list.templates.flatMap((item) => {
    const parsed = postTemplate.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  return {
    package_running: list.package_running,
    templates,
    dropped: list.templates.length - templates.length,
  };
}

const isFilled = (value: unknown) =>
  !(value === undefined || value === null || value === "" || value === false) &&
  !(Array.isArray(value) && value.length === 0);

/** The template fields from the form's fields: empty values and per-item details left out. */
export function templateDataFromForm(
  form: Pick<
    ListingDraftData,
    | "category"
    | "condition"
    | "categoryAttributes"
    | "description"
    | "province"
    | "city"
    | "town"
    | "address"
    | "contactMethods"
  >
): PostTemplateData {
  // Saved posts can hold numbers (bedrooms: 3); the form's fields are text.
  const details = Object.fromEntries(
    Object.entries(form.categoryAttributes ?? {})
      .filter(([key, value]) => !PER_ITEM_DETAILS.has(key) && isFilled(value))
      .map(([key, value]) => [key, typeof value === "number" ? String(value) : value])
  );
  const trimmed = (value: string | undefined) => value?.trim() || undefined;
  const data: PostTemplateData = {
    category: form.category,
    condition: trimmed(form.condition),
    categoryAttributes: Object.keys(details).length ? details : undefined,
    description: trimmed(form.description),
    province: trimmed(form.province),
    city: trimmed(form.city),
    town: trimmed(form.town),
    address: trimmed(form.address),
    contactMethods: form.contactMethods.filter((method) =>
      (CONTACT_BUTTONS as readonly string[]).includes(method)
    ) as PostTemplateData["contactMethods"],
  };
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as PostTemplateData;
}

/** The form's fields a template fills in (the rest stays as the form starts). */
export function formFieldsFromTemplate(data: PostTemplateData) {
  return {
    category: data.category,
    condition: data.condition ?? "",
    categoryAttributes: data.categoryAttributes ?? {},
    description: data.description ?? "",
    province: data.province ?? "",
    city: data.city ?? "",
    town: data.town ?? "",
    address: data.address ?? "",
    contactMethods: data.contactMethods?.length
      ? withListingEnquiry(data.contactMethods)
      : DEFAULT_LISTING_CONTACT_METHODS,
  };
}

/** "Market · Vehicles · 6 details" for a template card. */
export function templateSummary(data: PostTemplateData): string {
  // "Vehicles (Cars, Bakkies & Commercial)" reads "Vehicles" on a card.
  const label = CATEGORIES.find((c) => c.value === data.category)?.label ?? "Other";
  const category = label.replace(/ \(.*\)$/, "");
  const details =
    Object.values(data.categoryAttributes ?? {}).filter(isFilled).length + (data.condition ? 1 : 0);
  return `Market · ${category} · ${details} ${details === 1 ? "detail" : "details"}`;
}
