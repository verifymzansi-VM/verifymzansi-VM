// Contracts for the data shapes the restored screens receive from the
// foundation adapters (roadmap M6.6). Each field of a shape is one of:
//
// - required: a fact the live backend provides for every row (never blank);
// - optional: a fact the backend provides when the post or account has it (an
//   owner may leave it out, or the post kind has none), so it may be blank;
// - not available: declared next to the adapter (src/lib/foundation/
//   not-available.ts) with the placeholder the screen gets instead.
//
// checkScreenRow fails on a field that is in none of these lists, on a blank
// required field and on a not-available field holding anything but its
// placeholder. The same contracts run on canned data
// (src/lib/foundation/screen-data-contracts.test.ts) and against the live
// backend lane (e2e/foundation/screen-data-contracts.spec.ts), so an adapter
// that starts blanking a field, or a backend that stops providing one, fails a
// test instead of hiding data.
import {
  PUBLIC_CARD_NOT_AVAILABLE,
  PUBLIC_POST_NOT_AVAILABLE,
} from "@/lib/foundation/marketplace-read";
import { OWNER_POST_NOT_AVAILABLE } from "@/lib/foundation/restored-owner-posts";
import {
  ACCOUNT_PROFILE_NOT_AVAILABLE,
  DASHBOARD_ONLY_PROFILE_FACTS,
} from "@/lib/foundation/restored-profile";
import type { NotAvailableSet } from "@/lib/foundation/not-available";

export type ScreenContract = {
  /** The data shape and the screens it serves. */
  readonly name: string;
  readonly required: readonly string[];
  readonly optional: readonly string[];
  readonly notAvailable: readonly NotAvailableSet[];
};

/** Owner-entered presentation fields a public or owner post may carry
 * (presentedFormFields in src/lib/foundation/post-presentation.ts). */
const FORM_FIELDS = [
  "slug",
  "location_town",
  "location_address",
  "store_number",
  "map_directions",
  "email",
  "website",
  "social_links",
  "services_offered",
  "service_areas",
  "business_details",
  "category_details",
  "operating_hours",
  "payment_methods_accepted",
  "delivery_options",
  "layout_template",
  "event_details",
  "business_id",
  "category_key",
  "logo_url",
  "video_thumbnail",
  "phone",
  "whatsapp",
  "attributes",
] as const;
/** Public CIPC and Seen stickers a business card or page may carry. */
const BUSINESS_STICKERS = [
  "cipc_verified_at",
  "cipc_registration_number",
  "cipc_registered_name",
  "cipc_registered_office",
  "owner_verified_role",
  "owner_position_title",
  "seen_verified_at",
  "seen_method",
  "seen_city",
] as const;
const PUBLIC_REQUIRED = [
  "id",
  "title",
  "business_name",
  "description",
  "category",
  "location_province",
  "location_city",
  "created_at",
  "updated_at",
  "status",
  "promotion_type",
  "price_negotiable",
] as const;
const PUBLIC_OPTIONAL = [
  ...FORM_FIELDS,
  ...BUSINESS_STICKERS,
  "subcategory",
  "business_type",
  "price_mode",
  "price_cents",
  "condition",
  "photos",
  "videos",
  "cover_photo",
  "cover_video",
  "gallery_photos",
  "focal_x",
  "focal_y",
  "media_width",
  "media_height",
  "start_date",
  "end_date",
] as const;

/** Showroom cards: home strips, the market, business and tourism pages,
 * organisation pages and /api/marketplace (readRestoredCollection). */
export const PUBLIC_CARD_CONTRACT: ScreenContract = {
  name: "public post card",
  required: PUBLIC_REQUIRED,
  optional: PUBLIC_OPTIONAL,
  notAvailable: [PUBLIC_POST_NOT_AVAILABLE, PUBLIC_CARD_NOT_AVAILABLE],
};

/** Post pages (listing, business, event), the feed and the event host card
 * (restoredPublicRow over readRestoredPublicDetail). */
export const PUBLIC_DETAIL_CONTRACT: ScreenContract = {
  name: "public post page",
  required: [...PUBLIC_REQUIRED, "seller"],
  optional: [...PUBLIC_OPTIONAL, "contact_methods"],
  notAvailable: [PUBLIC_POST_NOT_AVAILABLE],
};

/** The owner's posts on the dashboard, the edit pages and staff review
 * (restoredOwnerPostRow). */
export const OWNER_POST_CONTRACT: ScreenContract = {
  name: "owner post",
  required: [
    "id",
    "owner_id",
    "user_id",
    "seller_id",
    "kind",
    "area",
    "title",
    "business_name",
    "description",
    "category",
    "status",
    "revision",
    "created_at",
    "updated_at",
    "location_province",
    "location_city",
    "promotion_type",
    "price_negotiable",
    "focal_x",
    "focal_y",
  ],
  optional: [
    ...FORM_FIELDS,
    "subcategory",
    "business_type",
    "status_reason",
    "moderation_notes",
    "rejection_reason",
    "edit_of",
    "pending_edit",
    "published_at",
    "expires_at",
    "deletes_at",
    "price_mode",
    "price_cents",
    "condition",
    "photos",
    "videos",
    "gallery_photos",
    "cover_photo",
    "cover_video",
    "media_width",
    "media_height",
    "contact_methods",
    "start_date",
    "end_date",
  ],
  notAvailable: [OWNER_POST_NOT_AVAILABLE],
};

const PROFILE_REQUIRED = [
  "id",
  "user_id",
  "display_name",
  "account_verification_status",
  "legal_name_locked",
  "created_at",
  "updated_at",
] as const;
const PROFILE_OPTIONAL = [
  "bio",
  "phone",
  "pending_phone",
  "avatar_url",
  "legal_first_name",
  "legal_last_name",
] as const;

/** The signed-in member's profile from the account read alone (the sign-in
 * hook, restoredAccountProfile). */
export const ACCOUNT_PROFILE_CONTRACT: ScreenContract = {
  name: "account profile",
  required: PROFILE_REQUIRED,
  optional: PROFILE_OPTIONAL,
  notAvailable: [ACCOUNT_PROFILE_NOT_AVAILABLE, DASHBOARD_ONLY_PROFILE_FACTS],
};

/** The profile on the owner dashboard and profile pages
 * (presentedDashboardProfile). */
export const DASHBOARD_PROFILE_CONTRACT: ScreenContract = {
  name: "dashboard profile",
  required: [...PROFILE_REQUIRED, "revision"],
  optional: [...PROFILE_OPTIONAL, ...Object.keys(DASHBOARD_ONLY_PROFILE_FACTS.fields)],
  notAvailable: [ACCOUNT_PROFILE_NOT_AVAILABLE],
};

function isBlank(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
  );
}

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Problems with one row against its screen contract; empty when the row
 * keeps the contract.
 */
export function checkScreenRow(contract: ScreenContract, row: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const placeholders = new Map<string, unknown>();
  for (const set of contract.notAvailable)
    for (const [key, field] of Object.entries(set.fields)) placeholders.set(key, field.placeholder);
  const required = new Set(contract.required);
  const optional = new Set(contract.optional);
  for (const key of new Set([...required, ...optional, ...placeholders.keys()]))
    if (Number(required.has(key)) + Number(optional.has(key)) + Number(placeholders.has(key)) > 1)
      problems.push(`${contract.name}: '${key}' is in more than one list`);
  for (const [key, value] of Object.entries(row)) {
    if (required.has(key)) {
      if (isBlank(value)) problems.push(`${contract.name}: required '${key}' is blank`);
    } else if (placeholders.has(key)) {
      if (!sameValue(value, placeholders.get(key)))
        problems.push(
          `${contract.name}: '${key}' is declared not available but holds a value (the backend provides it now? move it to required or optional)`
        );
    } else if (!optional.has(key))
      problems.push(
        `${contract.name}: '${key}' is not in the contract (declare it required, optional or not available)`
      );
  }
  for (const key of [...required, ...placeholders.keys()])
    if (!Object.hasOwn(row, key)) problems.push(`${contract.name}: '${key}' is missing`);
  return problems;
}
