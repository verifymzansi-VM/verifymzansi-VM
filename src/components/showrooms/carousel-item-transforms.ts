import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { formatRandAmount } from "@/lib/utils/format";
import type { CarouselItem } from "./showroom-card-carousel";

/** "R 1 250" for whole amounts, "R 99.50" when there are cents. */
function formatCardPrice(cents: number): string {
  return `R ${formatRandAmount(cents / 100, cents % 100 ? 2 : 0)}`;
}

export type { CarouselItem };

/* ── Listing → CarouselItem ─────────────────────────────── */

export function listingToCarouselItem(
  l: {
    id: string;
    title: string;
    description?: string | null;
    photos?: string[] | null;
    videos?: string[] | null;
    video_thumbnail?: string | null;
    logo_url?: string | null;
    price_cents?: number | null;
    location_city?: string | null;
    location_province?: string | null;
    focal_x?: number | null;
    focal_y?: number | null;
    media_width?: number | null;
    media_height?: number | null;
  },
  hrefOverride?: string
): CarouselItem {
  return {
    id: l.id,
    type: "listing",
    href: hrefOverride ?? `/listing/${l.id}`,
    title: l.title,
    description: l.description ?? undefined,
    location: l.location_city || l.location_province || "South Africa",
    mediaUrl: normalizeMediaUrl(
      l.videos?.[0] ?? l.photos?.[0] ?? "/images/fallbacks/hero-listing.svg"
    ),
    posterUrl: l.video_thumbnail
      ? normalizeMediaUrl(l.video_thumbnail)
      : l.photos?.[0]
        ? normalizeMediaUrl(l.photos[0])
        : undefined,
    logoUrl: l.logo_url ? normalizeMediaUrl(l.logo_url) : undefined,
    price: l.price_cents ? l.price_cents / 100 : null,
    eyebrow: l.price_cents ? formatCardPrice(l.price_cents) : null,
    focalX: l.focal_x ?? null,
    focalY: l.focal_y ?? null,
    mediaWidth: l.media_width ?? null,
    mediaHeight: l.media_height ?? null,
  };
}

/* ── Business → CarouselItem ────────────────────────────── */

export function businessToCarouselItem(
  b: {
    id: string;
    business_name: string;
    description?: string | null;
    cover_photo?: string | null;
    cover_video?: string | null;
    video_thumbnail?: string | null;
    logo_url?: string | null;
    location_city?: string | null;
    location_province?: string | null;
    focal_x?: number | null;
    focal_y?: number | null;
    media_width?: number | null;
    media_height?: number | null;
    category?: string | null;
  },
  hrefOverride?: string
): CarouselItem {
  const href =
    hrefOverride ??
    (b.category === "tourism_hospitality" ? `/tourism-events/${b.id}` : `/mzansi-business/${b.id}`);

  return {
    id: b.id,
    type: "business",
    href,
    title: b.business_name,
    description: b.description ?? undefined,
    location: b.location_city || b.location_province || "South Africa",
    mediaUrl: normalizeMediaUrl(
      b.cover_video ?? b.cover_photo ?? "/images/fallbacks/hero-business.svg"
    ),
    posterUrl: b.video_thumbnail
      ? normalizeMediaUrl(b.video_thumbnail)
      : b.cover_photo
        ? normalizeMediaUrl(b.cover_photo)
        : undefined,
    logoUrl: b.logo_url ? normalizeMediaUrl(b.logo_url) : undefined,
    focalX: b.focal_x ?? null,
    focalY: b.focal_y ?? null,
    mediaWidth: b.media_width ?? null,
    mediaHeight: b.media_height ?? null,
  };
}

/* ── Promotion / Event → CarouselItem ───────────────────── */

export function promotionToCarouselItem(
  p: {
    id: string;
    title: string;
    description?: string | null;
    photos?: string[] | null;
    videos?: string[] | null;
    video_thumbnail?: string | null;
    logo_url?: string | null;
    price_cents?: number | null;
    event_details?: { ticket_tiers?: Array<{ price_cents?: number | null }> } | null;
    location_city?: string | null;
    location_province?: string | null;
    focal_x?: number | null;
    focal_y?: number | null;
    media_width?: number | null;
    media_height?: number | null;
  },
  hrefOverride?: string
): CarouselItem {
  // Same figure as the event page: the cheapest ticket, "From" when there are several.
  const tierPrices = (p.event_details?.ticket_tiers ?? []).map((tier) => tier.price_cents ?? 0);
  const paid = tierPrices.filter((cents) => cents > 0);
  const lowest = paid.length > 0 ? Math.min(...paid) : null;
  const eyebrow =
    lowest != null
      ? `${tierPrices.length > 1 ? "From " : ""}${formatCardPrice(lowest)}`
      : tierPrices.length > 0
        ? "Free entry"
        : p.price_cents
          ? formatCardPrice(p.price_cents)
          : null;
  const priceCents = lowest ?? (tierPrices.length > 0 ? null : p.price_cents);
  return {
    id: p.id,
    type: "promotion",
    href: hrefOverride ?? `/tourism-events/${p.id}`,
    title: p.title,
    description: p.description ?? undefined,
    location: p.location_city || p.location_province || "South Africa",
    mediaUrl: normalizeMediaUrl(
      p.videos?.[0] ?? p.photos?.[0] ?? "/images/fallbacks/hero-shop.svg"
    ),
    posterUrl: p.video_thumbnail
      ? normalizeMediaUrl(p.video_thumbnail)
      : p.photos?.[0]
        ? normalizeMediaUrl(p.photos[0])
        : undefined,
    logoUrl: p.logo_url ? normalizeMediaUrl(p.logo_url) : undefined,
    price: priceCents ? priceCents / 100 : null,
    eyebrow,
    focalX: p.focal_x ?? null,
    focalY: p.focal_y ?? null,
    mediaWidth: p.media_width ?? null,
    mediaHeight: p.media_height ?? null,
  };
}
