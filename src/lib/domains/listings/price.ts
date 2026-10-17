import { z } from "zod";
import type { ListingCategory } from "@/types/enums";

// Foundation contract only. Existing routes keep their legacy price representation
// until the reviewed target schema and complete form/display adapters are ready.
export const MAX_LISTING_PRICE_CENTS = 9_999_999_900;
export const listingPriceInputSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("amount"),
    amount_cents: z.number().int().positive().max(MAX_LISTING_PRICE_CENTS),
  }),
  z.strictObject({ mode: z.literal("free") }),
  z.strictObject({ mode: z.literal("on_request") }),
]);

export type ListingPriceInput = z.infer<typeof listingPriceInputSchema>;
export type StoredListingPrice =
  | { price_mode: "amount"; price_cents: number }
  | { price_mode: "free"; price_cents: 0 }
  | { price_mode: "on_request"; price_cents: null };

/** Category must come from the validated taxonomy, never a display label. */
export function storeListingPrice(input: unknown, category: ListingCategory): StoredListingPrice {
  const price = listingPriceInputSchema.parse(input);
  if (price.mode === "free") {
    if (category === "jobs_services") throw new Error("A job salary cannot be Free");
    return { price_mode: "free", price_cents: 0 };
  }
  if (price.mode === "on_request") return { price_mode: "on_request", price_cents: null };
  return { price_mode: "amount", price_cents: price.amount_cents };
}

/** Reject corrupt database projections instead of silently labelling them free. */
export function readListingPrice(input: unknown, category: ListingCategory): ListingPriceInput {
  const stored = z
    .strictObject({
      price_mode: z.enum(["amount", "free", "on_request"]),
      price_cents: z.number().int().min(0).max(MAX_LISTING_PRICE_CENTS).nullable(),
    })
    .parse(input);
  if (stored.price_mode === "amount") {
    if (stored.price_cents === null || stored.price_cents === 0)
      throw new Error("Amount price requires positive cents");
    return { mode: "amount", amount_cents: stored.price_cents };
  }
  if (stored.price_mode === "free") {
    if (stored.price_cents !== 0 || category === "jobs_services")
      throw new Error("Invalid free price");
    return { mode: "free" };
  }
  if (stored.price_cents !== null) throw new Error("Price on request cannot contain an amount");
  return { mode: "on_request" };
}

export function listingPricePresentation(price: ListingPriceInput, category: ListingCategory) {
  // Use the same validation as persistence even for directly constructed DTOs.
  storeListingPrice(price, category);
  if (price.mode === "amount") return { kind: "amount" as const, cents: price.amount_cents };
  return {
    kind: "label" as const,
    label:
      price.mode === "free"
        ? "Free"
        : category === "jobs_services"
          ? "Salary not provided"
          : "Price on request",
  };
}
