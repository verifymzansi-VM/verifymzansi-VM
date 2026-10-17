import { z } from "zod";
import { MAX_LISTING_PRICE_CENTS } from "./price";

const filterSchema = z.strictObject({
  mode: z.enum(["amount", "free", "on_request"]).optional(),
  min_cents: z.number().int().min(0).max(MAX_LISTING_PRICE_CENTS).optional(),
  max_cents: z.number().int().min(0).max(MAX_LISTING_PRICE_CENTS).optional(),
});
/** A bounded database-query contract, not a JavaScript row-filter implementation. */
export function parseListingPriceFilter(input: unknown) {
  const filter = filterSchema.parse(input);
  const hasRange = filter.min_cents !== undefined || filter.max_cents !== undefined;
  if (hasRange && filter.mode !== undefined && filter.mode !== "amount")
    throw new Error("Price range requires amount mode");
  if (
    filter.min_cents !== undefined &&
    filter.max_cents !== undefined &&
    filter.min_cents > filter.max_cents
  )
    throw new Error("Minimum price exceeds maximum");
  return { ...filter, ...(hasRange ? { mode: "amount" as const } : {}) };
}
