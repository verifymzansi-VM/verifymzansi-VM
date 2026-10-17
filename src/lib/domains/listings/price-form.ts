import { z } from "zod";
import { MAX_LISTING_PRICE_CENTS } from "./price";
import {
  listingPriceCategorySchema,
  storeListingPriceTerms,
  readListingPriceTerms,
  type ListingPriceTerms,
} from "./price-terms";

export type ListingPriceForm = {
  mode: "" | "amount" | "free" | "on_request";
  amount: string;
  negotiable: boolean;
};
const formSchema = z.strictObject({
  mode: z.enum(["amount", "free", "on_request"]),
  amount: z.string().max(16),
  negotiable: z.boolean(),
});
export const emptyListingPriceForm = (): ListingPriceForm => ({
  mode: "",
  amount: "",
  negotiable: false,
});

/** Convert decimal text directly to cents; never use floating-point multiplication. */
export function parseListingPriceAmount(text: string): number {
  const normalized = text.trim();
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(normalized))
    throw new Error("Enter a positive rand amount with at most two decimal places");
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_LISTING_PRICE_CENTS)
    throw new Error("Enter a price within the allowed range");
  return cents;
}

export function changeListingPriceMode(
  form: ListingPriceForm,
  mode: ListingPriceForm["mode"]
): ListingPriceForm {
  if (form.mode === mode) return { ...form };
  // A mode change is explicit: discard hidden old values, including on return to amount.
  return { mode, amount: "", negotiable: false };
}

export function changeListingPriceCategory(
  form: ListingPriceForm,
  categoryInput: unknown
): ListingPriceForm {
  const category = listingPriceCategorySchema.parse(categoryInput);
  if (category === "jobs_services" && form.mode === "free") return emptyListingPriceForm();
  return {
    ...form,
    negotiable:
      category === "jobs_services" || !["amount", "on_request"].includes(form.mode)
        ? false
        : form.negotiable,
  };
}

export function listingPriceFormToTerms(input: unknown, categoryInput: unknown): ListingPriceTerms {
  const form = formSchema.parse(input);
  if ((form.mode !== "amount" && form.amount !== "") || (form.mode === "free" && form.negotiable))
    throw new Error("Clear the hidden amount and negotiable fields");
  const terms: ListingPriceTerms = {
    price:
      form.mode === "amount"
        ? { mode: "amount", amount_cents: parseListingPriceAmount(form.amount) }
        : { mode: form.mode },
    negotiable: form.negotiable,
  };
  storeListingPriceTerms(terms, categoryInput);
  return terms;
}

/** Restores only the explicit new storage contract, never guesses legacy zero intent. */
export function restoreListingPriceForm(input: unknown, categoryInput: unknown): ListingPriceForm {
  const terms = readListingPriceTerms(input, categoryInput);
  return {
    mode: terms.price.mode,
    negotiable: terms.negotiable,
    amount:
      terms.price.mode === "amount"
        ? `${Math.floor(terms.price.amount_cents / 100)}.${String(terms.price.amount_cents % 100).padStart(2, "0")}`
        : "",
  };
}
