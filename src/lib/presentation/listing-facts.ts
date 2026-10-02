import { CATEGORIES } from "@/lib/constants/categories";
import { resolveMarketProfileVariant } from "@/lib/presentation/profile-variants";
import { formatRandAmount } from "@/lib/utils/format";

export interface FactItem {
  label: string;
  value: string;
}

type AttributeOption = string | { value: string; label: string };

export const LISTING_CONTACT_METHOD_LABELS: Record<string, string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  form: "Enquiry form",
  in_app: "Enquiry form",
};

/** Turn a stored key such as `like_new` into readable text ("Like new"). */
export function humanizeKey(value: string) {
  const text = value.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function optionLabel(item: unknown, options?: AttributeOption[]) {
  const raw = String(item);
  const match = options?.find((option) =>
    typeof option === "string" ? option === raw : option.value === raw
  );
  if (match) return typeof match === "string" ? match : match.label;
  return /^[a-z0-9]+(_[a-z0-9]+)+$/.test(raw) ? humanizeKey(raw) : raw;
}

function formatFactValue(value: unknown, unit?: string, options?: AttributeOption[]) {
  if (Array.isArray(value)) {
    return value.map((item) => optionLabel(item, options)).join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (value == null) {
    return "";
  }
  if (typeof value === "number") {
    // Group digits for measured values (mileage, size) but never for years or counts.
    return unit ? `${formatRandAmount(value)} ${unit}` : String(value);
  }
  const label = optionLabel(value, options);
  return unit ? `${label} ${unit}` : label;
}

function isEmptyAttribute(value: unknown) {
  return value === "" || value == null || (Array.isArray(value) && value.length === 0);
}

/** Category fields in their configured order; humanised raw keys when a category has no config. */
export function buildListingFacts(listing: {
  category: string | null;
  attributes: Record<string, unknown> | null;
}): FactItem[] {
  const categoryDefinition = CATEGORIES.find((item) => item.value === listing.category);
  const orderedFacts =
    categoryDefinition?.attributeFields
      .map((field) => {
        const rawValue = listing.attributes?.[field.name];
        if (isEmptyAttribute(rawValue)) return null;
        return {
          label: field.label,
          value: formatFactValue(rawValue, field.unit, field.options),
        };
      })
      .filter((fact): fact is FactItem => Boolean(fact)) ?? [];

  const fallbackFacts = Object.entries(listing.attributes ?? {})
    .map(([key, value]) => {
      if (isEmptyAttribute(value)) return null;
      return { label: humanizeKey(key), value: formatFactValue(value) };
    })
    .filter((fact): fact is FactItem => Boolean(fact));

  return orderedFacts.length > 0 ? orderedFacts : fallbackFacts;
}

export function getListingDetailsHeading(category: string | null | undefined) {
  const variant = resolveMarketProfileVariant(
    category as Parameters<typeof resolveMarketProfileVariant>[0]
  );
  switch (variant) {
    case "property":
      return "Property details";
    case "motors":
      return "Vehicle details";
    case "services":
      return "Service details";
    default:
      return "Listing details";
  }
}

export function getListingCategoryLabel(category: string | null | undefined) {
  return (
    CATEGORIES.find((item) => item.value === category)?.label ??
    (category ? humanizeKey(category) : null)
  );
}

/**
 * Price line for a listing. A job with no disclosed salary is never shown as R0,
 * and a missing price is "on request" — only a positive amount is a price.
 */
export function describeListingPrice(listing: {
  category: string | null;
  price_cents: number | null;
}): { kind: "amount"; cents: number } | { kind: "none"; label: string } {
  if (listing.price_cents != null && listing.price_cents > 0) {
    return { kind: "amount", cents: listing.price_cents };
  }
  return {
    kind: "none",
    label: listing.category === "jobs_services" ? "Salary not provided" : "Price on request",
  };
}
