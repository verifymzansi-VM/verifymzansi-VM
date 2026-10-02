/**
 * Public slide builders for the desktop viewer. Pure: they take rows the server
 * already loaded and decide what each vertical shows, and where. Anything not
 * published (unchosen phone numbers, private account data) never enters a slide.
 */
import type {
  BusinessDetailRecord,
  BusinessPromotionRecord,
} from "@/components/business/business-detail-content";
import type { ListingDetailRecord } from "@/components/listings/listing-detail-content";
import type { PromotionDetailRecord } from "@/components/listings/promotion-detail-content";
import { CATEGORY_CTA_CONFIG } from "@/lib/business/category-layout-map";
import { getBusinessVenuePhotoUrls } from "@/lib/business/venue-photos";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { getListingConditionLabel } from "@/lib/constants/listing-condition";
import { canonicalHref } from "@/lib/feed/refs";
import type {
  FeedFact,
  FeedLink,
  FeedMediaItem,
  FeedOpeningHours,
  FeedSection,
  FeedSlide,
} from "@/lib/feed/types";
import { CUSTOMER_ACCESS_OPTIONS, customerAccessSchema } from "@/lib/forms/customer-access";
import { getCategoryDetailFields } from "@/lib/forms/business-category-details";
import { hasBusinessDeliveryAvailable } from "@/lib/forms/business-type-details";
import {
  acceptsInboxEnquiries,
  getBusinessProfileFacts,
  getBusinessTypeDetails,
  getSubcategoryLabel,
  getTourismViewerDetails,
  isTourismBusinessRecord,
  SOCIAL_LABELS,
} from "@/lib/presentation/business-facts";
import {
  buildEventCalendarUrl,
  EVENT_RAIN_POLICY_LABELS,
  EVENT_RECURRING_LABELS,
  formatLooseDate,
  getEventAgeLabel,
  formatEventWhen,
  getEventTypeLabel,
} from "@/lib/presentation/event-facts";
import {
  buildListingFacts,
  describeListingPrice,
  getListingCategoryLabel,
  getListingDetailsHeading,
  humanizeKey,
} from "@/lib/presentation/listing-facts";
import { resolveBusinessProfileFamily } from "@/lib/presentation/profile-variants";
import {
  formatRandAmount,
  formatSaLongDate,
  formatSaShortDate,
  formatZAR,
  formatZARShort,
} from "@/lib/utils/format";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import { safeExternalHref } from "@/lib/utils/sanitize-html";
import {
  BUSINESS_CATEGORY_LABELS,
  BUSINESS_TYPE_LABELS,
  type AccountVerificationStatus,
  type BusinessCategory,
  type BusinessType,
} from "@/types/enums";
import type { EventDetails, TicketTier } from "@/types/tourism-details";

export interface OwnerSummaryInput {
  display_name: string | null;
  account_verification_status?: AccountVerificationStatus | string | null;
  phone?: string | null;
}

export interface EngagementInput {
  views: number;
  likes: number;
  viewerHasLiked: boolean;
}

function initialsOf(name: string | null | undefined, fallback: string) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return letters || fallback;
}

function trustOf(owner: OwnerSummaryInput | null) {
  return owner
    ? computeTrustLevel(
        (owner.account_verification_status ?? null) as AccountVerificationStatus | null
      )
    : null;
}

/** Venue first, then only the place names the venue does not already mention. */
function venueLine(venue: string | null | undefined, parts: Array<string | null | undefined>) {
  const named = (venue ?? "").toLowerCase();
  return placeLine([
    venue,
    ...parts.filter((part) => !part || !named.includes(part.toLowerCase())),
  ]);
}

function placeLine(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(", ");
}

/** Only real web links survive; "#" and script URLs fall out. */
function externalLink(href: string | null | undefined): string | null {
  if (!href) return null;
  const safe = safeExternalHref(href);
  return safe && safe !== "#" && /^https?:\/\//i.test(safe) ? safe : null;
}

function nonEmpty<T extends FeedSection>(section: T | null | false | undefined): section is T {
  if (!section) return false;
  switch (section.type) {
    case "facts":
      return section.facts.length > 0;
    case "rows":
      return section.rows.length > 0;
    case "chips":
      return section.items.length > 0;
    case "links":
      return section.links.length > 0;
    case "text":
      return section.body.trim().length > 0;
    case "photos":
      return section.photos.length > 0;
    case "posts":
      return section.posts.length > 0;
    case "tickets":
      return section.tiers.length > 0 || Boolean(section.buyUrl);
    default:
      return true;
  }
}

function sections(...items: Array<FeedSection | null | false | undefined>): FeedSection[] {
  return items.filter(nonEmpty);
}

/* ───────────────────────── Mzansi Market ───────────────────────── */

export function presentListingSlide(
  listing: ListingDetailRecord,
  seller: OwnerSummaryInput | null,
  engagement: EngagementInput
): FeedSlide {
  const href = canonicalHref("listing", listing.id);
  const methods = listing.contact_methods ?? [];
  // Phone numbers are published only for the methods the seller chose.
  const phone = methods.includes("call") ? (seller?.phone ?? null) : null;
  const whatsapp = methods.includes("whatsapp") ? (seller?.phone ?? null) : null;
  const facts = buildListingFacts(listing);
  const price = describeListingPrice(listing);
  const photos = (listing.photos ?? []).map(normalizeMediaUrl).filter(Boolean);
  const videos = (listing.videos ?? []).map(normalizeMediaUrl).filter(Boolean);
  const poster = listing.video_thumbnail
    ? normalizeMediaUrl(listing.video_thumbnail)
    : (photos[0] ?? undefined);
  const media: FeedMediaItem[] = [
    ...videos.map((url) => ({ kind: "video" as const, url, poster })),
    ...photos.map((url) => ({ kind: "photo" as const, url })),
  ];
  const place = placeLine([
    listing.location_suburb,
    listing.location_city,
    listing.location_province,
  ]);

  return {
    key: `listings:${listing.id}`,
    kind: "listing",
    table: "listings",
    targetType: "listing",
    vertical: "market",
    id: listing.id,
    href,
    title: listing.title,
    shareTitle: listing.title,
    media,
    headline: {
      chips: [
        getListingCategoryLabel(listing.category),
        listing.condition ? getListingConditionLabel(listing.condition) : null,
      ].filter((chip): chip is string => Boolean(chip)),
      figure:
        price.kind === "amount"
          ? {
              value: formatZAR(price.cents),
              note: listing.price_negotiable ? "Negotiable" : undefined,
            }
          : { value: price.label },
      meta: [
        place ? { icon: "location" as const, text: place } : null,
        { icon: "date" as const, text: `Listed ${formatSaLongDate(listing.created_at)}` },
      ].filter((item): item is NonNullable<typeof item> => Boolean(item)),
    },
    owner: {
      label: "Seller",
      name: seller?.display_name || "Account name unavailable",
      initials: initialsOf(seller?.display_name, "S"),
      trustLevel: trustOf(seller),
      logoUrl: listing.logo_url ? normalizeMediaUrl(listing.logo_url) : null,
      href: null,
    },
    contact: {
      phone,
      whatsapp,
      showPhoneButton: true,
      showMessageButton:
        listing.contact_methods == null || methods.some((m) => ["form", "in_app"].includes(m)),
      cta: null,
    },
    engagement,
    website: null,
    // The listing form has no map link, so there is no location button.
    mapUrl: null,
    left: sections(
      {
        type: "facts",
        id: "quick-facts",
        eyebrow: "Quick facts",
        title: getListingDetailsHeading(listing.category),
        facts: facts.slice(0, 6),
      },
      listing.description
        ? {
            type: "text",
            id: "description",
            title: "Description",
            body: listing.description,
            clamp: true,
          }
        : null
    ),
    right: sections(
      { type: "contact", id: "contact" },
      // The area is already under the title; only the street address adds anything.
      listing.location_address
        ? { type: "text", id: "address", title: "Address", body: listing.location_address }
        : null,
      { type: "rows", id: "breakdown", title: "Full listing breakdown", rows: facts.slice(6) },
      { type: "safety", id: "safety" }
    ),
  };
}

/* ─────────────────── Mzansi Business and Tourism ─────────────────── */

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  eft: "EFT",
  snapscan: "SnapScan",
  capitec_pay: "Capitec Pay",
  other: "Other",
};

function businessMedia(business: BusinessDetailRecord): FeedMediaItem[] {
  const items: FeedMediaItem[] = [];
  const poster =
    business.video_thumbnail || business.cover_photo
      ? normalizeMediaUrl((business.video_thumbnail || business.cover_photo)!)
      : undefined;
  if (business.cover_video) {
    items.push({ kind: "video", url: normalizeMediaUrl(business.cover_video), poster });
  }
  const photos = [business.cover_photo, ...(business.gallery_photos ?? [])]
    .filter((photo): photo is string => Boolean(photo))
    .map(normalizeMediaUrl);
  for (const url of photos) {
    if (!items.some((item) => item.kind === "photo" && item.url === url)) {
      items.push({ kind: "photo", url });
    }
  }
  return items;
}

function normalizeHours(value: unknown): FeedOpeningHours | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const hours: FeedOpeningHours = {};
  for (const key of ["Mon_Fri", "Sat", "Sun"] as const) {
    if (typeof record[key] === "string" && record[key].trim()) hours[key] = record[key].trim();
  }
  return Object.keys(hours).length > 0 ? hours : null;
}

function customerAccessRows(value: unknown, meetingPoint: unknown): FeedFact[] {
  const parsed = customerAccessSchema.safeParse(value);
  const rows: FeedFact[] = [];
  if (parsed.success) {
    const access = parsed.data;
    const methods = CUSTOMER_ACCESS_OPTIONS.filter((option) =>
      access.methods.includes(option.value)
    );
    if (methods.length > 0) {
      rows.push({
        label: "We serve you by",
        value: methods.map((option) => option.label).join(", "),
      });
    }
    if (access.methods.includes("visit") && access.venue)
      rows.push({ label: "Venue", value: access.venue });
    if (access.methods.includes("travel") && access.serviceAreas) {
      rows.push({ label: "Service areas", value: String(access.serviceAreas) });
    }
    if (access.methods.includes("delivery")) {
      rows.push({
        label: "Delivery",
        value: access.nationwide ? "Nationwide" : String(access.deliveryAreas ?? ""),
      });
    }
  }
  if (typeof meetingPoint === "string" && meetingPoint.trim()) {
    rows.push({ label: "Meeting point", value: meetingPoint.trim() });
  }
  return rows.filter((row) => row.value.trim());
}

function categoryDetailFacts(business: BusinessDetailRecord): FeedFact[] {
  return getCategoryDetailFields(business.category as BusinessCategory)
    .map((field) => {
      const value = business.category_details?.[field.name];
      if (value == null || value === "" || (Array.isArray(value) && value.length === 0))
        return null;
      const format = (item: unknown) =>
        field.options?.find((option) => option.value === item)?.label ??
        String(item).replace(/_/g, " ");
      const text =
        typeof value === "boolean"
          ? value
            ? "Yes"
            : "No"
          : Array.isArray(value)
            ? value.map(format).join(", ")
            : format(value);
      return { label: field.label, value: text };
    })
    .filter((fact): fact is FeedFact => Boolean(fact));
}

export function presentBusinessSlide(
  business: BusinessDetailRecord,
  owner: OwnerSummaryInput | null,
  promotions: Pick<
    BusinessPromotionRecord,
    "id" | "title" | "photos" | "video_thumbnail" | "start_date" | "location_city"
  >[],
  engagement: EngagementInput
): FeedSlide {
  const family = resolveBusinessProfileFamily(
    business.category as BusinessCategory,
    business.business_type as BusinessType,
    business.subcategory
  );
  // Layout follows the profile family; the route follows where the page lives.
  const isTourism = family === "tourism";
  const inTourismSection = isTourism || isTourismBusinessRecord(business);
  const kind = inTourismSection ? ("tourism" as const) : ("business" as const);
  const href = canonicalHref(kind, business.id);
  const details = (business.category_details ?? {}) as Record<string, unknown>;
  const deliveryAvailable = hasBusinessDeliveryAvailable(
    business.delivery_options,
    business.business_details
  );
  const media = businessMedia(business);
  const ctaConfig = CATEGORY_CTA_CONFIG[business.category as BusinessCategory];
  const typeLabel =
    BUSINESS_TYPE_LABELS[business.business_type as BusinessType] ??
    (business.business_type ? humanizeKey(business.business_type) : null);
  const categoryLabel = BUSINESS_CATEGORY_LABELS[business.category as BusinessCategory] ?? null;
  const subcategoryLabel = getSubcategoryLabel(business.category, business.subcategory);
  const place = placeLine([
    business.location_town,
    business.location_city,
    business.location_province,
  ]);
  const hours = normalizeHours(business.operating_hours);
  const website = externalLink(business.website);
  const bookingUrl =
    isTourism && typeof details.booking_url === "string" ? externalLink(details.booking_url) : null;
  // Home businesses never publish a map pin to their home.
  const mapUrl =
    business.business_type === "home_business" ? null : externalLink(business.map_directions);
  const profileFacts = getBusinessProfileFacts(business, { includeLanguages: !isTourism });
  const starRating =
    typeof details.star_rating === "number" && details.star_rating > 0 ? details.star_rating : null;
  const grading =
    typeof details.tgcsa_grading === "string" && details.tgcsa_grading
      ? details.tgcsa_grading.replace(/_star$/, "-star").replace(/_/g, " ")
      : null;

  const typeDetails = getBusinessTypeDetails(business);
  const orderUrl = externalLink(typeDetails.orderUrl);
  const links: FeedLink[] = (
    [
      orderUrl && orderUrl !== website
        ? { label: "Order online", href: orderUrl, icon: "web" as const }
        : null,
      website ? { label: "Visit website", href: website, icon: "web" as const } : null,
      business.email
        ? { label: business.email, href: `mailto:${business.email}`, icon: "email" as const }
        : null,
      ...Object.entries(business.social_links ?? {}).map(([platform, url]) => {
        const safe = externalLink(url);
        return safe
          ? {
              label: SOCIAL_LABELS[platform] ?? humanizeKey(platform),
              href: safe,
              icon: "social" as const,
              platform,
            }
          : null;
      }),
    ] as Array<FeedLink | null>
  ).filter((link): link is FeedLink => Boolean(link));

  const paymentRows: FeedFact[] = [
    (business.payment_methods_accepted ?? []).length > 0
      ? {
          label: "Payment",
          value: (business.payment_methods_accepted ?? [])
            .map((method) => PAYMENT_METHOD_LABELS[method] ?? humanizeKey(method))
            .join(", "),
        }
      : null,
    deliveryAvailable ? { label: "Delivery", value: "Available" } : null,
  ].filter((row): row is FeedFact => Boolean(row));
  const accessRows = customerAccessRows(details.customer_access, details.meeting_point);
  // Customer access already says how delivery works; don't repeat it under payment.
  const paymentOnlyRows = accessRows.some((row) => row.label === "Delivery")
    ? paymentRows.filter((row) => row.label !== "Delivery")
    : paymentRows;
  // Only the street address and store number: the area is under the title.
  const addressRows = [
    business.location_address ? { label: "Address", value: business.location_address } : null,
    business.store_number ? { label: "Store", value: business.store_number } : null,
  ].filter((row): row is FeedFact => Boolean(row));

  const venuePhotos = getBusinessVenuePhotoUrls(
    business.business_details,
    business.category_details
  ).map((url, index) => ({
    url: normalizeMediaUrl(url),
    alt: `Entrance or landmark photo ${index + 1}`,
  }));
  const postsSection: FeedSection = {
    type: "posts",
    id: "posts",
    title: "Tourism & Events posts",
    posts: promotions.slice(0, 4).map((promotion) => ({
      key: promotion.id,
      title: promotion.title,
      href: `/tourism-events/${promotion.id}`,
      image:
        promotion.video_thumbnail || promotion.photos?.[0]
          ? normalizeMediaUrl((promotion.video_thumbnail || promotion.photos?.[0])!)
          : null,
      meta: promotion.start_date
        ? formatSaShortDate(promotion.start_date)
        : (promotion.location_city ?? null),
    })),
  };

  // Every field of the tourism form, grouped; anything left empty stays out.
  const stay = getTourismViewerDetails(details);
  const stayLists: FeedSection[] = stay.lists.map((list) => ({
    type: "chips",
    id: `list-${list.label}`,
    title: list.label,
    items: list.items,
  }));

  const left = isTourism
    ? sections(
        business.description
          ? {
              type: "text",
              id: "about",
              title: "About the stay",
              body: business.description,
              clamp: true,
            }
          : null,
        { type: "facts", id: "glance", title: "Stay details", facts: stay.facts },
        ...stayLists
      )
    : sections(
        business.description
          ? { type: "text", id: "about", title: "About", body: business.description, clamp: true }
          : null,
        {
          type: "facts",
          id: "glance",
          eyebrow: "At a glance",
          title: "Business details",
          // Counts of the lists below ("5 highlights") would only repeat them.
          facts: profileFacts,
        },
        {
          type: "chips",
          id: "services",
          title:
            family === "professional"
              ? "Service scope"
              : (ctaConfig?.servicesHeading ?? "Services"),
          items: business.services_offered ?? [],
        },
        {
          type: "chips",
          id: "areas",
          title: "Service areas",
          items: business.service_areas?.areas ?? [],
        },
        { type: "facts", id: "more", title: "More details", facts: categoryDetailFacts(business) }
      );

  const right = isTourism
    ? sections(
        { type: "contact", id: "contact" },
        { type: "rows", id: "policies", title: "Policies and house rules", rows: stay.rules },
        hours ? { type: "hours", id: "hours", title: "Opening hours", hours } : null,
        { type: "rows", id: "location", title: "Location", rows: addressRows },
        ...stay.notes.map((note): FeedSection => ({
          type: "text",
          id: `note-${note.label}`,
          title: note.label,
          body: note.value,
        })),
        { type: "links", id: "links", title: "Links", links },
        { type: "rows", id: "access", title: "Getting here", rows: accessRows },
        { type: "photos", id: "finding-us", title: "Finding us", photos: venuePhotos },
        postsSection
      )
    : sections(
        { type: "contact", id: "contact" },
        hours ? { type: "hours", id: "hours", title: "Opening hours", hours } : null,
        {
          type: "rows",
          id: "location",
          title: "Where to find us",
          rows: [...addressRows, ...typeDetails.rows],
        },
        ...typeDetails.lists.map((list): FeedSection => ({
          type: "chips",
          id: `type-${list.label}`,
          title: list.label,
          items: list.items,
        })),
        { type: "links", id: "links", title: "Website and socials", links },
        { type: "rows", id: "payment", title: "Payment and delivery", rows: paymentOnlyRows },
        { type: "rows", id: "access", title: "How we serve customers", rows: accessRows },
        { type: "photos", id: "finding-us", title: "Finding us", photos: venuePhotos },
        postsSection
      );

  return {
    key: `businesses:${business.id}`,
    kind,
    table: "businesses",
    targetType: "business",
    vertical: inTourismSection ? "tourism" : "business",
    id: business.id,
    href,
    title: business.business_name,
    shareTitle: business.business_name,
    media,
    headline: {
      // A stay's shop type ("Physical store") says nothing to a traveller.
      chips: [isTourism ? null : typeLabel, categoryLabel, subcategoryLabel].filter(
        (chip, index, all): chip is string => Boolean(chip) && all.indexOf(chip) === index
      ),
      figure:
        isTourism && (grading || starRating)
          ? {
              value: grading ? `${grading} graded` : `${starRating}-star`,
              note: grading ? "TGCSA" : undefined,
            }
          : null,
      meta: [place ? { icon: "location" as const, text: place } : null].filter(
        (item): item is NonNullable<typeof item> => Boolean(item)
      ),
      hours,
    },
    owner: {
      label: "Managed by",
      name: owner?.display_name || business.business_name,
      initials: initialsOf(business.business_name, "B"),
      trustLevel: trustOf(owner),
      logoUrl: business.logo_url ? normalizeMediaUrl(business.logo_url) : null,
      href: null,
    },
    contact: {
      phone: business.phone,
      whatsapp: business.whatsapp,
      showPhoneButton: true,
      showMessageButton: acceptsInboxEnquiries(business.category_details),
      cta: bookingUrl
        ? { label: ctaConfig?.primaryCta ?? "Book now", href: bookingUrl, icon: "booking" }
        : null,
    },
    engagement,
    website,
    mapUrl,
    left,
    right,
  };
}

/* ───────────────────────── Tourism & Events ───────────────────────── */

function eventMedia(promotion: PromotionDetailRecord): FeedMediaItem[] {
  const photos = (promotion.photos ?? []).map(normalizeMediaUrl).filter(Boolean);
  const videos = (promotion.videos ?? []).map(normalizeMediaUrl).filter(Boolean);
  const poster = promotion.video_thumbnail
    ? normalizeMediaUrl(promotion.video_thumbnail)
    : photos[0];
  const asVideo = (url: string) => ({ kind: "video" as const, url, poster });
  const asPhoto = (url: string) => ({ kind: "photo" as const, url });
  // Same order as the event page: a lead video first, else the lead photo.
  if (videos.length > 0) return [...videos.map(asVideo), ...photos.map(asPhoto)];
  return photos.map(asPhoto);
}

function ticketFigure(promotion: PromotionDetailRecord, tiers: TicketTier[]) {
  const prices = tiers
    .map((tier) => tier.price_cents)
    .filter((cents): cents is number => cents != null && cents > 0);
  if (prices.length > 0) {
    const lowest = Math.min(...prices);
    return { value: tiers.length > 1 ? `From ${formatZARShort(lowest)}` : formatZARShort(lowest) };
  }
  if (tiers.length > 0) return { value: "Free entry" };
  if (promotion.price_cents != null && promotion.price_cents > 0) {
    return {
      value: formatZAR(promotion.price_cents),
      note: promotion.price_negotiable ? "Negotiable" : undefined,
    };
  }
  return null;
}

export function presentEventSlide(
  promotion: PromotionDetailRecord,
  advertiser: OwnerSummaryInput | null,
  linkedBusiness: { id: string; business_name: string; logo_url: string | null } | null,
  engagement: EngagementInput
): FeedSlide {
  const href = canonicalHref("event", promotion.id);
  const details: EventDetails = promotion.event_details ?? {};
  const methods = promotion.contact_methods ?? [];
  const phone = methods.includes("call") ? (advertiser?.phone ?? null) : null;
  const whatsapp = methods.includes("whatsapp") ? (advertiser?.phone ?? null) : null;
  const tiers = details.ticket_tiers ?? [];
  const ticketsUrl = externalLink(details.tickets_url);
  const isEvent = promotion.promotion_type === "event";
  const rawCategory = getPromotionCategoryDisplayLabel(promotion.category_key, promotion.category);
  const categoryLabel =
    rawCategory && /^[a-z0-9_]+$/.test(rawCategory) ? humanizeKey(rawCategory) : rawCategory;
  const eventTypeLabel = getEventTypeLabel(details.event_type);
  const place = placeLine([
    promotion.location_town,
    promotion.location_city,
    promotion.location_province,
  ]);
  const when = formatEventWhen(promotion.start_date, promotion.end_date);
  const media = eventMedia(promotion);
  const calendarUrl = buildEventCalendarUrl({
    title: promotion.title,
    description: promotion.description,
    start_date: promotion.start_date,
    end_date: promotion.end_date,
    venueName: details.venue_name,
    location: [
      promotion.location_address,
      promotion.location_town,
      promotion.location_city,
      promotion.location_province,
    ],
  });
  const yesNo = (value: boolean | undefined) =>
    value == null ? null : value ? "Available" : "Not available";
  const knowBeforeYouGo: FeedFact[] = [
    promotion.location_address ? { label: "Address", value: promotion.location_address } : null,
    typeof details.venue_capacity === "number"
      ? { label: "Capacity", value: formatRandAmount(details.venue_capacity) }
      : null,
    getEventAgeLabel(details.age_restriction)
      ? { label: "Age restriction", value: getEventAgeLabel(details.age_restriction)! }
      : null,
    details.dress_code ? { label: "Dress code", value: details.dress_code } : null,
    yesNo(details.parking_available)
      ? { label: "Parking", value: yesNo(details.parking_available)! }
      : null,
    yesNo(details.food_drinks_available)
      ? { label: "Food & drinks", value: yesNo(details.food_drinks_available)! }
      : null,
    details.recurring
      ? {
          label: "Recurring",
          value: EVENT_RECURRING_LABELS[details.recurring] ?? details.recurring,
        }
      : null,
    details.rain_policy
      ? {
          label: "Rain policy",
          value: EVENT_RAIN_POLICY_LABELS[details.rain_policy] ?? details.rain_policy,
        }
      : null,
    details.early_bird_deadline
      ? { label: "Early-bird deadline", value: formatLooseDate(details.early_bird_deadline) }
      : null,
    yesNo(details.group_discount_available)
      ? { label: "Group discounts", value: yesNo(details.group_discount_available)! }
      : null,
  ].filter((fact): fact is FeedFact => Boolean(fact));

  const links: FeedLink[] = (
    [
      externalLink(details.website)
        ? { label: "Event website", href: externalLink(details.website)!, icon: "web" as const }
        : null,
      ...Object.entries(details.social_links ?? {}).map(([platform, url]) => {
        const safe = externalLink(url);
        return safe
          ? {
              label: SOCIAL_LABELS[platform] ?? humanizeKey(platform),
              href: safe,
              icon: "social" as const,
              platform,
            }
          : null;
      }),
    ] as Array<FeedLink | null>
  ).filter((link): link is FeedLink => Boolean(link));

  return {
    key: `promotions:${promotion.id}`,
    kind: "event",
    table: "promotions",
    targetType: "promotion",
    vertical: "tourism",
    id: promotion.id,
    href,
    title: promotion.title,
    shareTitle: promotion.title,
    media,
    headline: {
      chips: [eventTypeLabel, categoryLabel].filter(
        (chip, index, all): chip is string => Boolean(chip) && all.indexOf(chip) === index
      ),
      figure: ticketFigure(promotion, tiers),
      meta: [
        when ? { icon: "date" as const, text: when } : null,
        details.venue_name || place
          ? {
              icon: "location" as const,
              text: venueLine(details.venue_name, [
                promotion.location_town,
                promotion.location_city,
                promotion.location_province,
              ]),
            }
          : null,
      ].filter((item): item is NonNullable<typeof item> => Boolean(item)),
      event: isEvent
        ? { start: promotion.start_date, end: promotion.end_date, calendarUrl }
        : undefined,
    },
    owner: {
      label: isEvent ? "Organiser" : "Advertiser",
      name: linkedBusiness?.business_name || advertiser?.display_name || "Organiser",
      // The organiser's business profile, when the event is linked to one.
      href: linkedBusiness ? `/mzansi-business/${linkedBusiness.id}` : null,
      initials: initialsOf(linkedBusiness?.business_name || advertiser?.display_name, "E"),
      trustLevel: trustOf(advertiser),
      logoUrl: promotion.logo_url
        ? normalizeMediaUrl(promotion.logo_url)
        : linkedBusiness?.logo_url
          ? normalizeMediaUrl(linkedBusiness.logo_url)
          : null,
    },
    contact: {
      phone,
      whatsapp,
      showPhoneButton: methods.includes("call"),
      showMessageButton: methods.includes("form") || methods.includes("in_app"),
      cta: null,
    },
    engagement,
    website: externalLink(details.website),
    mapUrl: externalLink(details.map_directions),
    // When, where and the event type are already in the headline above.
    left: sections(
      {
        type: "tickets",
        id: "tickets",
        title: "Tickets",
        tiers: tiers.map((tier) => ({
          name: tier.name,
          price:
            tier.price_cents != null && tier.price_cents > 0
              ? formatZARShort(tier.price_cents)
              : "Free",
        })),
        buyUrl: ticketsUrl,
      },
      promotion.description
        ? {
            type: "text",
            id: "description",
            title: "About",
            body: promotion.description,
            clamp: true,
          }
        : null
    ),
    right: sections(
      { type: "contact", id: "contact" },
      details.lineup ? { type: "text", id: "lineup", title: "Lineup", body: details.lineup } : null,
      { type: "rows", id: "know", title: "Know before you go", rows: knowBeforeYouGo },
      {
        type: "chips",
        id: "accessibility",
        title: "Accessibility",
        items: details.accessibility ?? [],
      },
      details.bring_your_own
        ? { type: "text", id: "bring", title: "What to bring", body: details.bring_your_own }
        : null,
      { type: "links", id: "links", title: "Links and directions", links }
    ),
  };
}
