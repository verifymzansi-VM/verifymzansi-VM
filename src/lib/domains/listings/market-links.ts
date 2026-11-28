import { listingSocialLinkSchema, listingWebsiteSchema } from "@/lib/validations/listing";
import type { OnlinePresenceValues } from "@/components/post/online-presence-fields";

// Website and social links on a Market listing (presentation website / social_links).

export const EMPTY_MARKET_LINKS: OnlinePresenceValues = {
  website: "",
  mapDirections: "",
  socialFacebook: "",
  socialInstagram: "",
  socialTwitter: "",
  socialTiktok: "",
  socialYoutube: "",
};

const SOCIAL_KEYS = [
  ["socialFacebook", "facebook"],
  ["socialInstagram", "instagram"],
  ["socialTiktok", "tiktok"],
  ["socialYoutube", "youtube"],
  ["socialTwitter", "twitter"],
] as const;

/** The links as the listing request sends them: only filled networks. */
export function marketLinksPayload(values: OnlinePresenceValues) {
  const social_links: Record<string, string> = {};
  for (const [field, key] of SOCIAL_KEYS) {
    const value = values[field].trim();
    if (value) social_links[key] = value;
  }
  return { website: values.website.trim(), social_links };
}

/** A saved post's links for the form. */
export function marketLinksFromRow(row: Record<string, unknown>): OnlinePresenceValues {
  const social =
    row.social_links && typeof row.social_links === "object"
      ? (row.social_links as Record<string, unknown>)
      : {};
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const values = { ...EMPTY_MARKET_LINKS, website: text(row.website) };
  for (const [field, key] of SOCIAL_KEYS) values[field] = text(social[key]);
  return values;
}

/** Link errors keyed as the links block shows them ("website", "socialFacebook"). */
export function marketLinksErrors(values: OnlinePresenceValues): Record<string, string> {
  const errors: Record<string, string> = {};
  const website = listingWebsiteSchema.safeParse(values.website);
  if (!website.success) errors.website = website.error.issues[0]!.message;
  for (const [field] of SOCIAL_KEYS) {
    const result = listingSocialLinkSchema.safeParse(values[field]);
    if (!result.success) errors[field] = result.error.issues[0]!.message;
  }
  return errors;
}

/** Server error keys for links, as the links block shows them. */
export const MARKET_LINK_ERROR_ALIASES: Record<string, string> = Object.fromEntries(
  SOCIAL_KEYS.map(([field, key]) => [`social_links.${key}`, field])
);
