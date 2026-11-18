/**
 * Display-only sample posts.
 *
 * A short, static list of example posts shown in the showrooms so visitors can
 * see how the site looks. Each sample is presented as VerifyMzansi's own
 * display example: it names no business (the business line reads
 * "VerifyMzansi" with the site's shield), carries no trust badges, and its
 * Call and WhatsApp buttons reach VerifyMzansi (src/lib/sample-posts/contact.ts).
 *
 * Rules for entries (checked by `validateSamplePost` and its tests):
 * - No business names, people's names or contact details in any field.
 * - Media live in the public bucket as `media/samples/<slug>.mp4` and
 *   `media/samples/<slug>.webp`.
 * - Use the git-ignored `catalogue.local.json` (development only) to preview
 *   entries before they are committed.
 *
 * Everything is hidden until `SAMPLE_POSTS_ENABLED=true` is set on the
 * server. Staff can also remove one sample, and restore it, from the staff
 * area (/admin/sample-posts); the database keeps only that hide-list.
 *
 * This file is imported by the request proxy, so it stays dependency-light.
 */

/**
 * Where a sample appears. Market samples show in Mzansi Market, business
 * samples in Mzansi Business, tourism (places to stay and experiences) and
 * event samples in Tourism & Events. The home showroom shows them all.
 */
export type SamplePostArea = "market" | "business" | "tourism" | "event";

export interface SamplePostEntry {
  /** URL slug: lowercase words joined by hyphens (`/sample/<slug>`). */
  slug: string;
  area: SamplePostArea;
  /**
   * Market: a listing category. Business: a business category. Tourism: a
   * tourism activity (a place to stay or an experience). Event: an event type.
   */
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
  /**
   * Events only, optional: the day it takes place (YYYY-MM-DD). Once that day
   * has passed the date is no longer shown; the sample stays.
   */
  eventDate?: string;
  /**
   * Internal only, optional: whether the place was confirmed while preparing
   * the entry. Never shown and dropped when the entry is loaded.
   */
  locationConfirmed?: boolean;
}

/** The committed samples. Empty until entries are added in a reviewed change. */
export const APPROVED_SAMPLE_POSTS: readonly SamplePostEntry[] = [];

export { SAMPLE_POST_LABEL } from "./label";

/** The name every sample shows on its business line. */
export const SAMPLE_POST_PRESENTER = "VerifyMzansi";
/** The site's own shield, shown as every sample's logo. */
export const SAMPLE_POST_LOGO = "/images/brand-shield-small.png";

/** One switch for all samples; default off. Read at request time on the server. */
export function samplePostsEnabled(env: Record<string, string | undefined> = process.env) {
  return env.SAMPLE_POSTS_ENABLED?.trim().toLowerCase() === "true";
}

/* ── Valid values (kept in step with src/lib/domains/taxonomy/reference.json by tests) ── */

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
] as const;

/** Mzansi Business categories (tourism businesses are their own area). */
export const SAMPLE_BUSINESS_CATEGORIES = [
  "automotive_services",
  "beauty_personal",
  "trade_maintenance",
  "cleaning_garden",
  "fashion_accessories",
  "community_personal",
  "education_training",
  "electronics_tech",
  "events_entertainment",
  "fitness_wellness",
  "home_living",
  "groceries_essentials",
  "health_medical",
  "pets_animals",
  "professional_services",
  "food_dining",
  "transport_storage",
  "general_other",
] as const;

/** Tourism & Hospitality activities: places to stay and experiences. */
export const SAMPLE_TOURISM_ACTIVITIES = [
  "hotel_resort",
  "guest_house_bnb",
  "lodge_game_lodge",
  "backpackers_hostel",
  "self_catering",
  "tour_operator",
  "travel_agency",
  "safari_wildlife",
  "adventure_activities",
  "cultural_heritage",
  "car_rental_tourism",
  "campground_caravan",
  "spa_wellness_retreat",
  "tourist_attraction",
] as const;

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
  tourism: SAMPLE_TOURISM_ACTIVITIES,
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
  "eventDate",
  "locationConfirmed",
]);
const SAMPLE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MEDIA_PATTERNS: Record<SamplePostSource, { video: RegExp; poster: RegExp }> = {
  committed: {
    video: /^media\/samples\/[a-z0-9]+(?:-[a-z0-9]+)*\.mp4$/,
    poster: /^media\/samples\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/,
  },
  // A bare file name inside public/sample-posts-local/ (no folders, no "..").
  local: {
    video: /^[A-Za-z0-9_-][A-Za-z0-9 ._-]*\.(?:mp4|webm)$/i,
    poster: /^[A-Za-z0-9_-][A-Za-z0-9 ._-]*\.(?:webp|jpg|jpeg|png)$/i,
  },
};

/** Whether `value` is a well-formed sample slug (3 to 80 characters). */
export function isSampleSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 80 &&
    SAMPLE_SLUG_PATTERN.test(value)
  );
}

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

function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 2020 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
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
  if (!isSampleSlug(slug)) {
    errors.push("slug must be 3 to 80 lowercase letters, digits and single hyphens");
  }

  const area = raw.area as SamplePostArea;
  const categories = Object.hasOwn(CATEGORIES_BY_AREA, String(area))
    ? CATEGORIES_BY_AREA[area]
    : null;
  if (!categories) errors.push('area must be "market", "business", "tourism" or "event"');
  const category = text(raw.category);
  if (categories && (!category || !categories.includes(category))) {
    errors.push(`category "${String(raw.category)}" is not valid for area "${area}"`);
  }

  const title = text(raw.title);
  checkLength(errors, "title", title, 5, 100);
  const description = text(raw.description);
  checkLength(errors, "description", description, 20, 5000);
  const city = text(raw.city);
  checkLength(errors, "city", city, 2, 80);
  const province = text(raw.province);
  if (!province || !(SAMPLE_PROVINCES as readonly string[]).includes(province)) {
    errors.push("province must be a South African province name");
  }

  const media = MEDIA_PATTERNS[source];
  const videoKey = text(raw.videoKey);
  const posterKey = text(raw.posterKey);
  if (source === "committed") {
    // One media pair per slug: media/samples/<slug>.mp4 and .webp.
    if (videoKey !== `media/samples/${slug}.mp4` || !media.video.test(videoKey ?? "")) {
      errors.push("videoKey must be media/samples/<slug>.mp4");
    }
    if (posterKey !== `media/samples/${slug}.webp` || !media.poster.test(posterKey ?? "")) {
      errors.push("posterKey must be media/samples/<slug>.webp");
    }
  } else {
    if (!videoKey || !media.video.test(videoKey) || videoKey.includes("..")) {
      errors.push("videoKey must be a .mp4 or .webm file name in public/sample-posts-local/");
    }
    if (!posterKey || !media.poster.test(posterKey) || posterKey.includes("..")) {
      errors.push("posterKey must be an image file name in public/sample-posts-local/");
    }
  }

  let eventDate: string | undefined;
  if (raw.eventDate !== undefined) {
    const value = text(raw.eventDate);
    if (area !== "event") errors.push("eventDate is only for event samples");
    else if (!value || !isCalendarDate(value)) errors.push("eventDate must be a date (YYYY-MM-DD)");
    else eventDate = value;
  }

  if (raw.locationConfirmed !== undefined && typeof raw.locationConfirmed !== "boolean") {
    errors.push("locationConfirmed must be true or false");
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
      ...(eventDate ? { eventDate } : {}),
    },
  };
}

/** Today's date in South Africa (YYYY-MM-DD). */
export function southAfricanToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The event date to show: only while it is today or later in South Africa. */
export function upcomingEventDate(
  entry: Pick<SamplePostEntry, "eventDate">,
  now: Date = new Date()
): string | null {
  return entry.eventDate && entry.eventDate >= southAfricanToday(now) ? entry.eventDate : null;
}

/**
 * True when `/sample/<slug>` may be served in production as far as the code
 * knows: the switch is on and the slug belongs to a valid committed entry.
 * The proxy answers everything else with a real 404 before the page starts
 * streaming, and then checks the staff hide-list.
 */
export function isPublishedSampleSlug(
  slug: string,
  env: Record<string, string | undefined> = process.env,
  catalogue: readonly unknown[] = APPROVED_SAMPLE_POSTS
): boolean {
  if (!samplePostsEnabled(env) || !isSampleSlug(slug)) return false;
  return catalogue.some((value) => {
    const result = validateSamplePost(value, "committed");
    return result.ok && result.entry.slug === slug;
  });
}
