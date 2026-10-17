import { z } from "zod";
import { listingPriceCategorySchema, readListingPriceTerms } from "./price-terms";
import { restoreListingPriceForm, listingPriceFormToTerms } from "./price-form";

const draftSchema = z.strictObject({
  category_key: listingPriceCategorySchema,
  price_mode: z.enum(["amount", "free", "on_request"]),
  price_cents: z.number().nullable(),
  price_negotiable: z.boolean(),
  revision: z.number().int().min(1).max(2_147_483_647),
  expires_at: z.iso.datetime({ offset: true }),
});
const commandContextSchema = z.strictObject({
  category: listingPriceCategorySchema,
  expected_revision: z.number().int().min(0).max(2_147_483_646),
  form: z.unknown(),
});

/** Project the exact RPC DTO into form state; never pass metadata to the price tuple parser. */
export function restoreListingPriceDraft(input: unknown) {
  const draft = draftSchema.parse(input);
  const stored = {
    price_mode: draft.price_mode,
    price_cents: draft.price_cents,
    price_negotiable: draft.price_negotiable,
  };
  readListingPriceTerms(stored, draft.category_key);
  return {
    category: draft.category_key,
    expected_revision: draft.revision,
    expires_at: draft.expires_at,
    form: restoreListingPriceForm(stored, draft.category_key),
  };
}

/** Validate before network/storage side effects; Auth derives the owner, not this command. */
export function buildListingPriceDraftCommand(input: unknown) {
  const context = commandContextSchema.parse(input);
  return {
    p_category_key: context.category,
    p_expected_revision: context.expected_revision,
    p_terms: listingPriceFormToTerms(context.form, context.category),
  };
}
