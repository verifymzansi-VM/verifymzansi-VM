import { z } from "zod";
import { readCoreDraft } from "./identity";
import { listingPriceCategorySchema } from "../listings/price-terms";
import {
  listingPriceFormToTerms,
  restoreListingPriceForm,
  emptyListingPriceForm,
} from "../listings/price-form";

export function restoreCoreListingDraft(input: unknown) {
  const draft = z
    .strictObject({
      id: z.uuid(),
      kind: z.literal("listing"),
      area: z.literal("market"),
      category_key: listingPriceCategorySchema,
      status: z.literal("draft"),
      revision: z.number().int().min(1).max(2147483647),
      price_mode: z.enum(["amount", "free", "on_request"]).nullable(),
      price_cents: z.number().nullable(),
      price_negotiable: z.boolean(),
    })
    .parse(input);
  const { price_mode, price_cents, price_negotiable, ...identity } = draft;
  readCoreDraft(identity);
  if (price_mode === null && (price_cents !== null || price_negotiable))
    throw new Error("Invalid unpriced draft");
  return {
    id: draft.id,
    category: draft.category_key,
    expected_revision: draft.revision,
    form:
      price_mode === null
        ? emptyListingPriceForm()
        : restoreListingPriceForm(
            { price_mode, price_cents, price_negotiable },
            draft.category_key
          ),
  };
}

/** The database derives category/owner/state from the locked post, not command metadata. */
export function buildCoreListingTermsCommand(input: unknown) {
  const context = z
    .strictObject({
      id: z.uuid(),
      category: listingPriceCategorySchema,
      expected_revision: z.number().int().min(1).max(2147483646),
      form: z.unknown(),
    })
    .parse(input);
  return {
    p_id: context.id,
    p_expected_revision: context.expected_revision,
    p_terms: listingPriceFormToTerms(context.form, context.category),
  };
}
