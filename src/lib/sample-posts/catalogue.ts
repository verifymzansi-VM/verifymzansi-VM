/**
 * Display-only sample posts.
 *
 * A short, static list of example posts shown in the showrooms so visitors can
 * see how the site will look. Each entry is a real local business's video,
 * added only after that business has given written permission. Nothing here
 * goes through the database: no SQL, no migration, no member account.
 *
 * Rules for entries (checked by `validateSamplePost` and its tests):
 * - Commit an entry only after the business has approved it. The repository
 *   is public, so unapproved names and media never belong in this file. Use
 *   the git-ignored `catalogue.local.json` (development only) to preview them.
 * - `contact` is included only when the business agreed to show it, and then
 *   carries `approvedByBusiness: true`. Never invent numbers.
 * - Media live in the public bucket under `media/samples/<slug>.<ext>`.
 *
 * Everything is hidden until `SAMPLE_POSTS_ENABLED=true` is set on the
 * server. Unset it (or set anything else) to hide every sample at once.
 *
 * This file is imported by the request proxy, so it stays dependency-light.
 */
import type { BusinessCategory, ListingCategory } from "@/types/enums";
import { isValidSaPhone } from "@/lib/utils/phone";

/** Where a sample appears: Mzansi Market, Mzansi Business, or Tourism & Events. */
export type SamplePostArea = "market" | "business" | "event";

export interface SamplePostContact {
  /** Must be `true`: the business agreed to show this contact. */
  approvedByBusiness: true;
  phone?: string;
  whatsapp?: string;
}

export interface SamplePostEntry {
  /** URL slug: lowercase words joined by hyphens (`/sample/<slug>`). */
  slug: string;
  area: SamplePostArea;
  /** Listing category (market), business category (business) or event type (event). */
  category: string;
  /** 5 to 100 characters, as for real posts. */
  title: string;
  /** 20 to 5000 characters, as for real posts. */
  description: string;
  province: string;
  city: string;
  /** Committed: `media/samples/<slug>.mp4`. Local preview: a file name in `public/sample-posts-local/`. */
  videoKey: string;
  /** Committed: `media/samples/<slug>.webp`. Local preview: a file name in `public/sample-posts-local/`. */
  posterKey: string;
  /** The business that gave permission. */
  businessName: string;
  contact?: SamplePostContact;
}

/**
 * Approved samples. Starts empty: entries are added one business at a time,
 * after that business says yes.
 */
export const APPROVED_SAMPLE_POSTS: readonly SamplePostEntry[] = [];

export { SAMPLE_POST_LABEL } from "./label";

/** One switch for all samples; default off. Read at request time on the server. */
export function samplePostsEnabled(env: Record<string, string | undefined> = process.env) {
  return env.SAMPLE_POSTS_ENABLED?.trim().toLowerCase() === "true";
}

/* ── Valid values (kept in step with src/types/enums.ts and categories.ts by tests) ── */

export const SAMPLE_LISTING_CATEGORIES = [
  "property",
  "vehicles",
  "auto_parts",
  "electronics",
  "home_lifestyle",
  "jobs_services",
  "farming_agriculture",
  "baby_kids",
  "clothing_accessories",
  "sports_hobbies",
  "other_items",
] as const satisfies readonly ListingCategory[];

/** Business categories offered to new posts (legacy ones excluded). */
export const SAMPLE_BUSINESS_CATEGORIES = [
  "fashion_accessories",
  "electronics_tech",
  "groceries_essentials",
  "home_living",
  "food_dining",
  "trade_maintenance",
  "professional_services",
  "education_training",
  "events_entertainment",
  "tourism_hospitality",
  "general_other",
  "health_medical",
  "beauty_personal",
  "fitness_wellness",
  "cleaning_garden",
  "automotive_services",
  "transport_storage",
  "pets_animals",
  "community_personal",
] as const satisfies readonly BusinessCategory[];

export const SAMPLE_EVENT_TYPES = [
  "festival_concert",
  "conference_seminar",
  "market_expo",
  "sports_event",
  "cultural_heritage",
  "food_wine",
  "outdoor_adventure",
  "workshop_masterclass",
  "charity_fundraiser",
  "community_gathering",
  "comedy_theatre",
  "kids_family",
  "nightlife_party",
] as const;

const CATEGORIES_BY_AREA: Record<SamplePostArea, readonly string[]> = {
  market: SAMPLE_LISTING_CATEGORIES,
  business: SAMPLE_BUSINESS_CATEGORIES,
  event: SAMPLE_EVENT_TYPES,
};

export const SAMPLE_PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
] as const;

/* ── Validation ─────────────────────────────────────────────── */

/** Committed entries come from this file; local ones from the git-ignored preview file. */
export type SamplePostSource = "committed" | "local";

const ENTRY_KEYS = new Set([
  "slug",
  "area",
  "category",
  "title",
  "description",
  "province",
  "city",
  "videoKey",
  "posterKey",
  "businessName",
  "contact",
]);
const CONTACT_KEYS = new Set(["approvedByBusiness", "phone", "whatsapp"]);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MEDIA_PATTERNS: Record<SamplePostSource, { video: RegExp; poster: RegExp }> = {
  committed: {
    video: /^media\/samples\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:mp4|webm)$/,
    poster: /^media\/samples\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|jpg|jpeg|png)$/,
  },
  // A bare file name inside public/sample-posts-local/ (no folders, no "..").
  local: {
    video: /^[A-Za-z0-9_-][A-Za-z0-9 ._-]*\.(?:mp4|webm)$/i,
    poster: /^[A-Za-z0-9_-][A-Za-z0-9 ._-]*\.(?:webp|jpg|jpeg|png)$/i,
  },
};

export type SamplePostValidation =
  { ok: true; entry: SamplePostEntry } | { ok: false; errors: string[] };

function text(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function checkLength(
  errors: string[],
  field: string,
  value: string | null,
  min: number,
  max: number
) {
  if (value === null || value.length < min || value.length > max) {
    errors.push(`${field} must be ${min} to ${max} characters`);
  }
}

/** Checks one entry. Invalid entries are never shown. */
export function validateSamplePost(
  value: unknown,
  source: SamplePostSource = "committed"
): SamplePostValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["entry must be an object"] };
  }
  const raw = value as Record<string, unknown>;
  const errors: string[] = [];

  for (const key of Object.keys(raw)) {
    if (!ENTRY_KEYS.has(key)) errors.push(`unknown field "${key}"`);
  }

  const slug = text(raw.slug);
  if (!slug || slug.length < 3 || slug.length > 80 || !SLUG_PATTERN.test(slug)) {
    errors.push("slug must be 3 to 80 lowercase letters, digits and single hyphens");
  }

  const area = raw.area as SamplePostArea;
  const categories = Object.hasOwn(CATEGORIES_BY_AREA, String(area))
    ? CATEGORIES_BY_AREA[area]
    : null;
  if (!categories) errors.push('area must be "market", "business" or "event"');
  const category = text(raw.category);
  if (categories && (!category || !categories.includes(category))) {
    errors.push(`category "${String(raw.category)}" is not valid for area "${area}"`);
  }

  const title = text(raw.title);
  checkLength(errors, "title", title, 5, 100);
  const description = text(raw.description);
  checkLength(errors, "description", description, 20, 5000);
  const businessName = text(raw.businessName);
  checkLength(errors, "businessName", businessName, 2, 120);
  const city = text(raw.city);
  checkLength(errors, "city", city, 2, 80);
  const province = text(raw.province);
  if (!province || !(SAMPLE_PROVINCES as readonly string[]).includes(province)) {
    errors.push("province must be a South African province name");
  }

  const media = MEDIA_PATTERNS[source];
  const videoKey = text(raw.videoKey);
  if (!videoKey || !media.video.test(videoKey) || videoKey.includes("..")) {
    errors.push(
      source === "committed"
        ? "videoKey must look like media/samples/<slug>.mp4"
        : "videoKey must be a .mp4 or .webm file name in public/sample-posts-local/"
    );
  }
  const posterKey = text(raw.posterKey);
  if (!posterKey || !media.poster.test(posterKey) || posterKey.includes("..")) {
    errors.push(
      source === "committed"
        ? "posterKey must look like media/samples/<slug>.webp"
        : "posterKey must be an image file name in public/sample-posts-local/"
    );
  }

  let contact: SamplePostContact | undefined;
  if (raw.contact !== undefined) {
    const value = raw.contact as Record<string, unknown> | null;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push("contact must be an object");
    } else {
      for (const key of Object.keys(value)) {
        if (!CONTACT_KEYS.has(key)) errors.push(`unknown contact field "${key}"`);
      }
      if (value.approvedByBusiness !== true) {
        errors.push("contact needs approvedByBusiness: true (the business agreed to show it)");
      }
      const phone = text(value.phone) || undefined;
      const whatsapp = text(value.whatsapp) || undefined;
      if (!phone && !whatsapp) errors.push("contact needs a phone or whatsapp number");
      if (phone && !isValidSaPhone(phone)) errors.push("contact.phone is not a valid SA number");
      if (whatsapp && !isValidSaPhone(whatsapp)) {
        errors.push("contact.whatsapp is not a valid SA number");
      }
      contact = {
        approvedByBusiness: true,
        ...(phone ? { phone } : {}),
        ...(whatsapp ? { whatsapp } : {}),
      };
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    entry: {
      slug: slug!,
      area,
      category: category!,
      title: title!,
      description: description!,
      province: province!,
      city: city!,
      videoKey: videoKey!,
      posterKey: posterKey!,
      businessName: businessName!,
      ...(contact ? { contact } : {}),
    },
  };
}

/**
 * True when `/sample/<slug>` may be served in production: the switch is on and
 * the slug belongs to a valid committed entry. The proxy answers everything
 * else with a real 404 before the page starts streaming.
 */
export function isPublishedSampleSlug(
  slug: string,
  env: Record<string, string | undefined> = process.env,
  catalogue: readonly unknown[] = APPROVED_SAMPLE_POSTS
): boolean {
  if (!samplePostsEnabled(env) || !SLUG_PATTERN.test(slug)) return false;
  return catalogue.some((value) => {
    const result = validateSamplePost(value, "committed");
    return result.ok && result.entry.slug === slug;
  });
}
