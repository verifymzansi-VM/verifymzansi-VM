import { z } from "zod";
import {
  saBusinessContactNumberInputSchema,
  storedSaBusinessContactNumberSchema,
} from "./business-contact-number";
import {
  isValidUserEnteredUrl,
  normalizeUserEnteredUrl,
  normalizeUserEnteredUrlInput,
} from "../../utils/external-url";

// Preserve the current business form's five explicit choices. Unlike the
// listing compatibility input, business input does not invent an in_app alias.
const businessContactChannels = ["call", "whatsapp", "email", "website", "form"] as const;
const businessContactSelectionSchema = z
  .array(z.enum(businessContactChannels))
  .max(5)
  .transform((values) => businessContactChannels.filter((channel) => values.includes(channel)));
const storedBusinessContactSelectionSchema = z
  .array(z.enum(businessContactChannels))
  .max(5)
  .refine(
    (values) =>
      JSON.stringify(values) ===
      JSON.stringify(businessContactChannels.filter((channel) => values.includes(channel)))
  );

const email = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.email().max(254)
);
const isCanonicalWebsite = (value: string) =>
  normalizeUserEnteredUrl(value) === value &&
  /^https?:\/\//i.test(value) &&
  isValidUserEnteredUrl(value);
const website = z.preprocess(
  normalizeUserEnteredUrlInput,
  z.string().max(2000).refine(isCanonicalWebsite)
);
const input = z.strictObject({
  channels: businessContactSelectionSchema,
  phone: z.unknown().optional(),
  whatsapp: z.unknown().optional(),
  email: z.unknown().optional(),
  website: z.unknown().optional(),
});

/** A configured private draft. An outer nullable DTO must represent unset.
 * Missing selected values remain null for private preparation; SQL publication
 * must require the selected fields and current independent number proofs.
 */
export const storedBusinessContactPreferencesSchema = z
  .strictObject({
    channels: storedBusinessContactSelectionSchema,
    phone: storedSaBusinessContactNumberSchema.nullable(),
    whatsapp: storedSaBusinessContactNumberSchema.nullable(),
    email: z.email().max(254).nullable(),
    website: z.string().max(2000).refine(isCanonicalWebsite).nullable(),
  })
  .refine(
    (value) =>
      (value.channels.includes("call") || value.phone === null) &&
      (value.channels.includes("whatsapp") || value.whatsapp === null) &&
      (value.channels.includes("email") || value.email === null) &&
      (value.channels.includes("website") || value.website === null)
  );

export type BusinessContactPreferences = z.infer<typeof storedBusinessContactPreferencesSchema>;

function optionalValue<T>(value: unknown, schema: z.ZodType<T>): T | null {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim()))
    return null;
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid business contact preferences");
  return parsed.data;
}

/** Explicit selection only. Discard deselected form values before validation,
 * never retain stale hidden contacts, infer a verified flag, or copy account data.
 */
export function buildBusinessContactPreferences(value: unknown): BusinessContactPreferences {
  const parsed = input.safeParse(value);
  if (!parsed.success) throw new Error("Invalid business contact preferences");
  const form = parsed.data,
    channels = form.channels;
  return {
    channels,
    phone: channels.includes("call")
      ? optionalValue(form.phone, saBusinessContactNumberInputSchema)
      : null,
    whatsapp: channels.includes("whatsapp")
      ? optionalValue(form.whatsapp, saBusinessContactNumberInputSchema)
      : null,
    email: channels.includes("email") ? optionalValue(form.email, email) : null,
    website: channels.includes("website") ? optionalValue(form.website, website) : null,
  };
}
