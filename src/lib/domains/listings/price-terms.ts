import { z } from "zod";
import { CATEGORY_LABELS, type ListingCategory } from "@/types/enums";
import {
  listingPriceInputSchema,
  storeListingPrice,
  readListingPrice,
  type StoredListingPrice,
} from "./price";

export const listingPriceCategorySchema = z.enum(
  Object.keys(CATEGORY_LABELS) as [ListingCategory, ...ListingCategory[]]
);
export const listingPriceTermsSchema = z.strictObject({
  price: listingPriceInputSchema,
  negotiable: z.boolean().default(false),
});
export type ListingPriceTerms = z.infer<typeof listingPriceTermsSchema>;
export type StoredListingPriceTerms = StoredListingPrice & { price_negotiable: boolean };

/** Advertising terms only; no publication, entitlement or payment authority. */
export function storeListingPriceTerms(
  input: unknown,
  categoryInput: unknown
): StoredListingPriceTerms {
  const category = listingPriceCategorySchema.parse(categoryInput);
  const terms = listingPriceTermsSchema.parse(input);
  if (terms.negotiable && (terms.price.mode === "free" || category === "jobs_services")) {
    throw new Error("Negotiable applies only to amount or request-priced non-job listings");
  }
  return { ...storeListingPrice(terms.price, category), price_negotiable: terms.negotiable };
}

export function readListingPriceTerms(input: unknown, categoryInput: unknown): ListingPriceTerms {
  const category = listingPriceCategorySchema.parse(categoryInput);
  const stored = z
    .strictObject({
      price_mode: z.enum(["amount", "free", "on_request"]),
      price_cents: z.number().nullable(),
      price_negotiable: z.boolean(),
    })
    .parse(input);
  const price = readListingPrice(
    { price_mode: stored.price_mode, price_cents: stored.price_cents },
    category
  );
  const terms = { price, negotiable: stored.price_negotiable };
  storeListingPriceTerms(terms, category);
  return terms;
}
