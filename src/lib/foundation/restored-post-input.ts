import { z } from "zod";
import { listingSchema } from "../validations/listing";
import { businessSchema } from "../validations/business-unified";
import { promotionSchema } from "../validations/promotion";
import { parseListingAttributes, parseAttributeMoney } from "../domains/taxonomy/attributes";
import { postContactSelectionSchema } from "../domains/posts/contact-channels";
import { storeListingPriceTerms } from "../domains/listings/price-terms";
import { resolveRestoredLocality } from "./restored-locality";
import reference from "../domains/taxonomy/reference.json";
import { isTrustedPlatformMediaUrl } from "../utils/media-url";
import { buildBusinessMutationPayload } from "@/app/api/businesses/_lib/build-business-mutation-payload";
import { getBusinessVenuePhotoUrls } from "../business/venue-photos";

const envelope = z.looseObject({
  postRequestId: z.uuid().transform((value) => value.toLowerCase()),
  postingTerms: z.strictObject({
    version: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    document_hash: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }),
  expectedRevision: z.number().int().min(1).max(2147483646).optional(),
});
export class RestoredPostInputError extends Error {}
export function restoredMediaObjectId(value: string) {
  if (!isTrustedPlatformMediaUrl(value))
    throw new RestoredPostInputError("Upload the media through this form before submitting");
  const path = new URL(value).pathname.replace(/^\/api\/media\/serve\//, "/");
  const match = /^\/media\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/.exec(path);
  if (!match)
    throw new RestoredPostInputError("An older upload cannot be used. Upload the file again.");
  return match[1]!;
}
type MediaItem = {
  object_id: string;
  purpose: "cover" | "gallery" | "video";
  position: number;
  focal_x?: number;
  focal_y?: number;
};
type PresentationMedia = {
  object_id: string;
  purpose: "logo" | "poster" | "venue";
  position: number;
};
function media(
  images: string[],
  videos: string[],
  logo: string | null | undefined,
  poster: string | null | undefined,
  focalX?: number,
  focalY?: number,
  venue: string[] = []
) {
  const photos = [...new Set(images.filter(Boolean))];
  const items: MediaItem[] = photos.map((url, index) => ({
    object_id: restoredMediaObjectId(url),
    purpose: index === 0 ? "cover" : "gallery",
    position: index === 0 ? 0 : index - 1,
    ...(index === 0 ? { focal_x: focalX ?? 0.5, focal_y: focalY ?? 0.5 } : {}),
  }));
  items.push(
    ...[...new Set(videos.filter(Boolean))].map((url, index) => ({
      object_id: restoredMediaObjectId(url),
      purpose: "video" as const,
      position: index,
    }))
  );
  const extra: PresentationMedia[] = [];
  if (logo) extra.push({ object_id: restoredMediaObjectId(logo), purpose: "logo", position: 0 });
  if (poster)
    extra.push({ object_id: restoredMediaObjectId(poster), purpose: "poster", position: 0 });
  extra.push(
    ...[...new Set(venue)].map((url, index) => ({
      object_id: restoredMediaObjectId(url),
      purpose: "venue" as const,
      position: index,
    }))
  );
  return { media: items, presentation_media: extra };
}
function activity(category: string, input: string | undefined, required = false) {
  if (!input) {
    if (required) throw new RestoredPostInputError("Choose the activity for this post");
    return null;
  }
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[\s&/-]+/g, "_");
  const row = reference.activities.find(
    (a) =>
      a.category === category &&
      (a.key === input || a.label.toLowerCase() === input.toLowerCase() || a.key === normalized)
  );
  if (!row) throw new RestoredPostInputError("Choose a valid activity for this category");
  return row.key;
}
/** This normalized command is accepted only through a server-attested stage.
 * The database still derives ownership, funding, publication and verification.
 * All fields are existing form assertions; none can confer a role or badge. */
export function buildRestoredPostInput(
  collection: "listings" | "businesses" | "promotions",
  input: unknown,
  fallbackLocality?: { province: string; city: string },
  editing = false
) {
  const transport = envelope.parse(input);
  if (editing && transport.expectedRevision === undefined)
    throw new RestoredPostInputError("Reload your post before saving changes");
  if (collection === "listings") {
    const data = listingSchema.parse(input);
    if (!editing && !data.termsAccepted)
      throw new RestoredPostInputError("Accept the posting terms before submitting");
    const pair = resolveRestoredLocality(data.province, data.city);
    const sourceAttrs = data.attributes as Record<string, unknown>;
    const canonical: Record<string, unknown> = {};
    for (const field of reference.listingFields.filter((f) => f.category === data.category)) {
      const value = field.key === "condition" ? data.condition : sourceAttrs[field.sourceKey];
      if (value === undefined || value === "") continue;
      canonical[field.key] =
        field.unit === "ZAR_cents" ? parseAttributeMoney(String(value)) : value;
    }
    const attributes = parseListingAttributes(data.category, canonical);
    const price =
      data.price_zar > 0
        ? { mode: "amount" as const, amount_cents: parseAttributeMoney(String(data.price_zar)) }
        : { mode: data.category === "jobs_services" ? ("on_request" as const) : ("free" as const) };
    const terms = { price, negotiable: data.negotiable };
    storeListingPriceTerms(terms, data.category);
    return {
      request_id: transport.postRequestId,
      expected_revision: transport.expectedRevision,
      context: {
        kind: "listing" as const,
        area: "market" as const,
        category: data.category,
        activity: null,
      },
      detail: { contact_channels: postContactSelectionSchema.parse(data.contactMethods) },
      content: {
        title: data.title,
        description: data.description,
        province_id: pair.p_province,
        city_id: pair.p_city,
      },
      listing_terms: terms,
      attributes,
      trial_days: data.trialDays,
      terms: transport.postingTerms,
      terms_accepted: !editing && data.termsAccepted,
      ...media(
        data.images,
        data.videos,
        data.logo_url,
        data.videoThumbnail,
        data.focal_x,
        data.focal_y
      ),
      presentation: {
        location_town: data.town || null,
        location_address: data.address || null,
        source_attributes: sourceAttrs,
      },
    };
  }
  if (collection === "businesses") {
    const data = businessSchema.parse(input);
    if (!editing && !data.termsAccepted)
      throw new RestoredPostInputError("Accept the posting terms before submitting");
    const normalized = buildBusinessMutationPayload(data);
    const row = reference.categories.find((c) => c.key === data.category && c.kind === "business");
    if (!row) throw new RestoredPostInputError("Choose a supported business category");
    const pair = resolveRestoredLocality(
      data.location_province || fallbackLocality?.province || "",
      data.location_city || fallbackLocality?.city || ""
    );
    const {
      phone,
      whatsapp,
      logo_url,
      cover_photo,
      cover_video,
      video_thumbnail,
      gallery_photos,
      ...presentation
    } = normalized;
    // Business numbers remain private until the existing contact-reveal boundary.
    return {
      request_id: transport.postRequestId,
      expected_revision: transport.expectedRevision,
      context: {
        kind: "business" as const,
        area: row.area,
        category: row.key,
        activity: activity(row.key, data.subcategory, row.activityRequired),
      },
      detail: {},
      content: {
        title: data.business_name,
        description: data.description,
        province_id: pair.p_province,
        city_id: pair.p_city,
      },
      business_type: normalized.business_type,
      trial_days: data.trialDays,
      terms: transport.postingTerms,
      terms_accepted: !editing && data.termsAccepted,
      contacts: { phone: phone || null, whatsapp: whatsapp || null },
      ...media(
        [cover_photo, ...gallery_photos].filter((v): v is string => !!v),
        cover_video ? [cover_video] : [],
        logo_url,
        video_thumbnail,
        data.focal_x,
        data.focal_y,
        getBusinessVenuePhotoUrls(data.business_details, data.category_details)
      ),
      presentation,
    };
  }
  const data = promotionSchema.parse(input);
  if (!editing && !data.termsAccepted)
    throw new RestoredPostInputError("Accept the posting terms before submitting");
  if (
    !data.start_date ||
    !data.end_date ||
    Date.parse(data.end_date) <= Date.parse(data.start_date)
  )
    throw new RestoredPostInputError("Choose an event end time after its start time");
  const pair = resolveRestoredLocality(data.province, data.city);
  return {
    request_id: transport.postRequestId,
    expected_revision: transport.expectedRevision,
    context: {
      kind: "event" as const,
      area: "tourism_events" as const,
      category: "events",
      activity: activity("events", data.event_details?.event_type, true),
    },
    detail: {
      contact_channels: postContactSelectionSchema.parse(data.contact_methods),
      starts_at: data.start_date,
      ends_at: data.end_date,
      timezone: "Africa/Johannesburg",
    },
    content: {
      title: data.title,
      description: data.description,
      province_id: pair.p_province,
      city_id: pair.p_city,
    },
    trial_days: null,
    terms: transport.postingTerms,
    terms_accepted: !editing && data.termsAccepted,
    ...media(
      data.images,
      data.videos,
      data.logo_url,
      data.video_thumbnail,
      data.focal_x,
      data.focal_y
    ),
    presentation: {
      location_town: data.location_town || null,
      location_address: data.location_address || null,
      event_details: data.event_details ?? {},
      category_label: data.category ?? null,
      category_key: data.category_key ?? null,
      business_id: data.business_id ?? null,
      ticket_price_cents:
        data.price_zar === undefined ? null : parseAttributeMoney(String(data.price_zar)),
    },
  };
}
export type RestoredPostCommand = ReturnType<typeof buildRestoredPostInput>;
