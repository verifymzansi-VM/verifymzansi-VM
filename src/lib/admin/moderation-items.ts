import type { ClaimItemType } from "@/lib/services/queue-claims";
import type { MarketplaceArea } from "@/types/enums";

/**
 * The one definition of a content item waiting for moderation: which columns
 * are read and how each row becomes a queue item. Both the moderation page and
 * the area pages build their queues from these, so they always agree on what
 * a reviewer sees, and only these columns ever reach the browser.
 */

export const LISTING_FIELDS =
  "id, title, status, created_at, updated_at, category, owner_id, description, photos, videos, video_thumbnail, price_cents, price_negotiable, location_province, location_city, location_suburb, attributes, contact_methods, buyer_verification_required" as const;

export const BUSINESS_FIELDS =
  "id, business_name, business_type, status, created_at, updated_at, owner_id, area, description, category, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province, location_city, store_number, website, social_links, operating_hours, services_offered, payment_methods_accepted, delivery_options, service_areas, business_details" as const;

export const PROMOTION_FIELDS =
  "id, title, status, created_at, updated_at, category, category_key, owner_id, description, photos, videos, video_thumbnail, logo_url, price_cents, price_negotiable, location_province, location_city, contact_methods, promotion_type" as const;

export const EDIT_FIELDS =
  "id, target_type, target_id, owner_id, area, status, proposed_data, current_snapshot, created_at" as const;

/** PostgREST filter for businesses that belong to Tourism & Events. */
export const TOURISM_BUSINESS_FILTER = "area.eq.PROMOTIONS_EVENTS,category.eq.tourism_hospitality";

/**
 * PostgREST filter for businesses that belong to Mzansi Business: the rest.
 * A missing category counts as "not tourism"; a plain `neq` would drop it.
 */
export const MZANSI_BUSINESS_FILTER = "category.is.null,category.neq.tourism_hospitality";

function isTourismBusiness(row: { area?: string | null; category?: string | null }) {
  return row.area === "PROMOTIONS_EVENTS" || row.category === "tourism_hospitality";
}

type Area = Extract<MarketplaceArea, "MZANSI_MARKET" | "MZANSI_BUSINESS" | "PROMOTIONS_EVENTS">;

export function listingItem<T extends { title: string }>(row: T) {
  return {
    ...row,
    area: "MZANSI_MARKET" as Area,
    areaLabel: "Mzansi Market",
    itemType: "Listing",
    contentType: "listing" as const,
  };
}

export function businessItem<
  T extends { business_name: string; area?: string | null; category?: string | null },
>(row: T) {
  const tourism = isTourismBusiness(row);
  return {
    ...row,
    title: row.business_name,
    area: (tourism ? "PROMOTIONS_EVENTS" : "MZANSI_BUSINESS") as Area,
    areaLabel: tourism ? "Tourism & Events" : "Mzansi Business",
    itemType: tourism ? "Tourism business" : "Business",
    contentType: "business" as const,
  };
}

export function promotionItem<T extends { category?: string | null; category_key?: string | null }>(
  row: T
) {
  return {
    ...row,
    // `category_key` is the canonical taxonomy value. Keep the legacy free-text
    // category for display when present, but never hide a correctly
    // categorised promotion whose legacy value is empty.
    category: row.category?.trim() ? row.category : row.category_key,
    area: "PROMOTIONS_EVENTS" as Area,
    areaLabel: "Tourism & Events",
    itemType: "Event",
    contentType: "promotion" as const,
  };
}

export function oldestFirst<T extends { created_at: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

/** Which queue claim covers a content item: an edit request, or the post itself. */
export function claimTypeOf(item: {
  isEditRequest?: boolean;
  contentType?: "listing" | "business" | "promotion";
}): ClaimItemType {
  return item.isEditRequest ? "content_edit" : (item.contentType ?? "listing");
}
