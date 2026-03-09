import { CATEGORIES } from "@/lib/constants/categories";
import type { ListingCategory } from "@/types/enums";
import { listingSchema } from "@/lib/validations/listing";

type RawListingAttributeValue = string | number | boolean;
type RawListingAttributes = Record<string, RawListingAttributeValue>;

const LISTING_BASELINE = {
  title: "Valid Listing Title",
  description: "This placeholder description is long enough to satisfy schema validation.",
  price_zar: 1,
  negotiable: false,
  province: "Gauteng",
  city: "Johannesburg",
  images: ["https://media.verifymzansi.com/listings/example.jpg"],
} as const;

function getCategoryDefinition(category: ListingCategory) {
  return CATEGORIES.find((item) => item.value === category);
}

export function coerceListingAttributes(
  category: ListingCategory,
  rawAttributes: RawListingAttributes
): Record<string, string | number | boolean> {
  const definition = getCategoryDefinition(category);
  if (!definition) return {};

  const coerced: Record<string, string | number | boolean> = {};

  for (const field of definition.attributeFields) {
    const rawValue = rawAttributes[field.name];

    if (field.type === "boolean") {
      if (typeof rawValue === "boolean") {
        coerced[field.name] = rawValue;
      }
      continue;
    }

    if (field.type === "number") {
      if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        coerced[field.name] = rawValue;
        continue;
      }

      if (typeof rawValue === "string") {
        const trimmed = rawValue.trim();
        if (!trimmed) {
          continue;
        }

        const numericValue = Number(trimmed);
        if (Number.isFinite(numericValue)) {
          coerced[field.name] = numericValue;
        }
      }

      continue;
    }

    if (typeof rawValue !== "string") {
      continue;
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
      continue;
    }

    coerced[field.name] = trimmed;
  }

  return coerced;
}

export function validateListingAttributes(
  category: ListingCategory,
  rawAttributes: RawListingAttributes
): Record<string, string> {
  const result = listingSchema.safeParse({
    ...LISTING_BASELINE,
    category,
    attributes: coerceListingAttributes(category, rawAttributes),
  });

  if (result.success) {
    return {};
  }

  const errors: Record<string, string> = {};

  for (const issue of result.error.issues) {
    if (issue.path[0] !== "attributes" || typeof issue.path[1] !== "string") {
      continue;
    }

    const key = `attributes.${issue.path[1]}`;
    if (!errors[key]) {
      errors[key] = issue.message;
    }
  }

  return errors;
}
