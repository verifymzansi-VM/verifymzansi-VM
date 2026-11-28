import { CATEGORIES } from "@/lib/constants/categories";
import { formatSaLongDate, formatZARShort } from "@/lib/utils/format";

/** Under "How the buyer gets it", on the form and on the post. */
export const MEET_SAFELY_LINE =
  "Meet in a busy public place in daylight. Some police stations allow meet-ups; check with yours first.";

/** On the job form and on every job post. */
export const JOB_SAFETY_LINE = "Never pay to apply for a job.";

type Attributes = Record<string, string | number | boolean | string[]>;

function fieldsOf(category: string) {
  return CATEGORIES.find((c) => c.value === category)?.attributeFields ?? [];
}

/**
 * The answers as they are sent: answers to questions the form no longer shows
 * (a deposit after switching to "For sale") are dropped, and property's pets
 * choice is mirrored to the searchable pets_allowed (Ask: none).
 */
export function finishListingAttributes(category: string, attributes: Attributes): Attributes {
  const out: Attributes = { ...attributes };
  for (const field of fieldsOf(category)) {
    if (!field.dependsOn || !field.dependsOnValue) continue;
    const allowed = Array.isArray(field.dependsOnValue)
      ? field.dependsOnValue
      : [field.dependsOnValue];
    if (!allowed.includes(String(out[field.dependsOn] ?? ""))) delete out[field.name];
  }
  if (category === "property") {
    if (out.pets_policy === "allowed") out.pets_allowed = true;
    else if (out.pets_policy === "not_allowed") out.pets_allowed = false;
    else delete out.pets_allowed;
  }
  return out;
}

/** A saved post's answers for the form: an older post's pets yes/no becomes the pets choice. */
export function listingAttributesForForm<T extends Record<string, unknown>>(attributes: T): T {
  if (attributes.pets_policy !== undefined || typeof attributes.pets_allowed !== "boolean")
    return attributes;
  return { ...attributes, pets_policy: attributes.pets_allowed ? "allowed" : "not_allowed" };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A post's answers as its page shows them: dates and the deposit in words, pets shown once. */
export function listingAttributesForDisplay(
  category: string | null,
  attributes: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!attributes || !category) return attributes;
  const out: Record<string, unknown> = listingAttributesForForm(attributes);
  if (category === "property" && out.pets_policy !== undefined) delete out.pets_allowed;
  for (const field of fieldsOf(category)) {
    const value = out[field.name];
    if (field.type === "date" && typeof value === "string" && ISO_DATE.test(value))
      out[field.name] = formatSaLongDate(`${value}T12:00:00Z`) || value;
  }
  if (typeof out.deposit_zar === "number") out.deposit_zar = formatZARShort(out.deposit_zar * 100);
  // The seller ticked "I deliver"; a buyer reads it as the seller delivering.
  if (Array.isArray(out.delivery_methods))
    out.delivery_methods = out.delivery_methods.map((method) =>
      method === "seller_delivers" ? "Seller delivers" : method
    );
  return out;
}

export function hasDeliveryMethods(attributes: Record<string, unknown> | null | undefined) {
  return Array.isArray(attributes?.delivery_methods) && attributes.delivery_methods.length > 0;
}

/** The contact methods sent: without a verified number (once the profile is known), no call or WhatsApp. */
export function sentContactMethods(
  methods: string[],
  profile: { phone?: string | null } | null | undefined
) {
  return profile && !profile.phone?.trim()
    ? methods.filter((method) => method !== "call" && method !== "whatsapp")
    : methods;
}
