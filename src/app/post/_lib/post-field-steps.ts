import { lookupFieldPath } from "@/lib/forms/field-paths";

/**
 * Which wizard step (0-based) shows each field, keyed by the field paths the
 * forms and the API use. A nested path such as `service_areas.areas` uses the
 * step of its nearest listed prefix; anything unlisted belongs to step 0.
 */
type FieldSteps = Record<string, number>;

function onStep(step: number, keys: string[]): FieldSteps {
  return Object.fromEntries(keys.map((key) => [key, step]));
}

export const BUSINESS_FIELD_STEPS: FieldSteps = {
  ...onStep(1, [
    "business_type",
    "location_province",
    "location_city",
    "location_town",
    "location_address",
    "store_number",
    "service_areas",
    "customer_access",
    "category_details.customer_access",
    "delivery_options",
  ]),
  ...onStep(2, [
    "contact_methods",
    "category_details.contact_methods",
    "phone",
    "whatsapp",
    "email",
    "website",
    "map_directions",
    "social_links",
    "socialFacebook",
    "socialInstagram",
    "socialTwitter",
    "socialTiktok",
    "operating_hours",
    "payment_methods_accepted",
  ]),
  ...onStep(3, [
    "logo_url",
    "cover_photo",
    "gallery_photos",
    "cover_video",
    "video_thumbnail",
    "layout_template",
    "termsAccepted",
  ]),
};

/** Keys after the listing form's aliases (contact_methods → contactMethods, …). */
export const LISTING_FIELD_STEPS: FieldSteps = {
  ...onStep(1, [
    "price_zar",
    "negotiable",
    "province",
    "city",
    "town",
    "address",
    "contactMethods",
  ]),
  ...onStep(2, ["logo_url", "videoThumbnail", "images", "videos", "termsAccepted"]),
};

/** Keys after the tourism form's aliases (start_date → startDate, …). */
export const TOURISM_FIELD_STEPS: FieldSteps = {
  ...onStep(1, [
    "eventType",
    "starRating",
    "numberOfRooms",
    "bookingUrl",
    "startDate",
    "endDate",
    "priceZar",
    "venueName",
    "venueCapacity",
    "ticketsUrl",
    "event_details",
    "category_details",
  ]),
  ...onStep(2, [
    "province",
    "city",
    "locationTown",
    "locationAddress",
    "contactMethods",
    "joinMethods",
    "meetingPoint",
    "pickupAreas",
    "category_details.meeting_point",
    "category_details.customer_access",
    "phone",
    "whatsapp",
    "email",
    "website",
    "socialFacebook",
    "socialInstagram",
    "socialTwitter",
    "socialTiktok",
    "social_links",
    "mapDirections",
    "operating_hours",
  ]),
  ...onStep(3, [
    "logo_url",
    "images",
    "videos",
    "video_thumbnail",
    "cover_photo",
    "cover_video",
    "gallery_photos",
    "termsAccepted",
  ]),
};

export function stepForField(key: string, steps: FieldSteps): number {
  return lookupFieldPath(key, steps) ?? 0;
}

/** The earliest step holding one of the errors, so the banner and wizard open there. */
export function stepForFieldErrors(
  errors: Record<string, string>,
  steps: FieldSteps,
  lastStep: number
): number {
  const keys = Object.keys(errors);
  if (keys.length === 0) return 0;
  return keys.reduce((step, key) => Math.min(step, stepForField(key, steps)), lastStep);
}
