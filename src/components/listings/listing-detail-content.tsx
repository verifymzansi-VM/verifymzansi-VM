"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Calendar, Eye, MapPin, Phone, MessageCircle } from "lucide-react";
import { contactPhone, whatsappLink } from "@/lib/utils/contact-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DetailSection,
  FactGrid,
  PosterTrustCard,
  SafetyTipsCard,
  type DetailFact,
} from "@/components/listings/detail-panels";
import { cn } from "@/lib/utils";
import { ListingCard } from "@/components/listings/listing-card";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { readOwnerId } from "@/lib/account/compat";
import { formatRandAmount, formatSaLongDate, formatZARShort } from "@/lib/utils/format";
import { CATEGORIES } from "@/lib/constants/categories";
import { ListingDetailClient } from "@/app/listing/[id]/client";
import { ListingContactActions } from "@/app/listing/[id]/listing-contact-actions";
import { getListingConditionLabel } from "@/lib/constants/listing-condition";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { StickyMobileBar } from "@/components/ui/sticky-mobile-bar";
import { resolveMarketProfileVariant } from "@/lib/presentation/profile-variants";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import type { AccountVerificationStatus } from "@/types/enums";

export interface ListingDetailRecord {
  id: string;
  owner_id?: string | null;
  title: string;
  description: string | null;
  price_cents: number | null;
  price_negotiable: boolean;
  category: string | null;
  condition: string | null;
  attributes: Record<string, unknown> | null;
  photos: string[] | null;
  videos: string[] | null;
  video_thumbnail: string | null;
  logo_url?: string | null;
  location_province: string | null;
  location_city: string | null;
  location_suburb: string | null;
  location_address: string | null;
  contact_methods: string[] | null;
  view_count?: number | null;
  created_at: string;
  media_width?: number | null;
  media_height?: number | null;
  focal_x?: number | null;
  focal_y?: number | null;
}

export interface ListingSellerRecord {
  display_name: string | null;
  location_province: string | null;
  location_city: string | null;
  account_verification_status: AccountVerificationStatus | null;
  phone?: string | null;
  masked_phone_public?: string | null;
}

export interface SimilarListingRow {
  id: string;
  title: string;
  price_cents: number | null;
  price_negotiable: boolean;
  condition: string | null;
  photos: string[];
  videos?: string[] | null;
  video_thumbnail?: string | null;
  logo_url?: string | null;
  location_province: string;
  location_city: string;
  category: string;
  attributes: Record<string, unknown>;
  focal_x?: number | null;
  focal_y?: number | null;
  media_width?: number | null;
  media_height?: number | null;
  created_at: string;
  boost_until: string | null;
  featured: boolean;
  owner_id?: string | null;
  view_count?: number | null;
  like_count?: number | null;
  viewer_has_liked?: boolean;
}

export interface SimilarSellerRow {
  user_id: string;
  display_name: string;
  account_verification_status: AccountVerificationStatus | null;
}

interface FactItem {
  label: string;
  value: string;
}

type AttributeOption = string | { value: string; label: string };

/** Turn a stored key such as `like_new` into readable text ("Like new"). */
function humanizeKey(value: string) {
  const text = value.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function optionLabel(item: unknown, options?: AttributeOption[]) {
  const raw = String(item);
  const match = options?.find((option) =>
    typeof option === "string" ? option === raw : option.value === raw
  );
  if (match) return typeof match === "string" ? match : match.label;
  return /^[a-z0-9]+(_[a-z0-9]+)+$/.test(raw) ? humanizeKey(raw) : raw;
}

function formatFactValue(value: unknown, unit?: string, options?: AttributeOption[]) {
  if (Array.isArray(value)) {
    return value.map((item) => optionLabel(item, options)).join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (value == null) {
    return "";
  }
  if (typeof value === "number") {
    // Group digits for measured values (mileage, size) but never for years or counts.
    return unit ? `${formatRandAmount(value)} ${unit}` : String(value);
  }
  const label = optionLabel(value, options);
  return unit ? `${label} ${unit}` : label;
}

function buildListingFacts(listing: ListingDetailRecord) {
  const categoryDefinition = CATEGORIES.find((item) => item.value === listing.category);
  const orderedFacts =
    categoryDefinition?.attributeFields
      .map((field) => {
        const rawValue = listing.attributes?.[field.name];
        if (
          rawValue === "" ||
          rawValue == null ||
          (Array.isArray(rawValue) && rawValue.length === 0)
        ) {
          return null;
        }
        return {
          label: field.label,
          value: formatFactValue(rawValue, field.unit, field.options),
        };
      })
      .filter((fact): fact is FactItem => Boolean(fact)) ?? [];

  const fallbackFacts = Object.entries(listing.attributes ?? {})
    .map(([key, value]) => {
      if (value === "" || value == null || (Array.isArray(value) && value.length === 0)) {
        return null;
      }
      return { label: humanizeKey(key), value: formatFactValue(value) };
    })
    .filter((fact): fact is FactItem => Boolean(fact));

  return orderedFacts.length > 0 ? orderedFacts : fallbackFacts;
}

function getVariantCopy(category: string | null | undefined) {
  const variant = resolveMarketProfileVariant(
    category as Parameters<typeof resolveMarketProfileVariant>[0]
  );
  switch (variant) {
    case "property":
      return { aboutHeading: "About this property", detailsHeading: "Property details" };
    case "motors":
      return { aboutHeading: "About this vehicle", detailsHeading: "Vehicle details" };
    case "services":
      return { aboutHeading: "About this service", detailsHeading: "Service details" };
    default:
      return { aboutHeading: "About this item", detailsHeading: "Item details" };
  }
}

const PUBLIC_GRID =
  "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:gap-x-8 xl:grid-cols-[minmax(0,1fr)_24rem]";
const REVIEW_GRID =
  "grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-rows-[auto_1fr] 2xl:gap-x-8";

export function ListingDetailContent({
  listing,
  seller,
  showContactActions = true,
  showSimilarListings = true,
  similarItems = [],
  similarSellers = new Map<string, SimilarSellerRow>(),
  photoCount,
  trackView = true,
  layoutMode = "public",
}: {
  listing: ListingDetailRecord;
  seller: ListingSellerRecord | null;
  showContactActions?: boolean;
  showSimilarListings?: boolean;
  similarItems?: SimilarListingRow[];
  similarSellers?: Map<string, SimilarSellerRow>;
  photoCount?: number;
  trackView?: boolean;
  layoutMode?: "public" | "review";
}) {
  const isReviewLayout = layoutMode === "review";
  // Previews show the poster's own name ("You"); the trust note only makes sense publicly.
  const trustLevel =
    seller && !isReviewLayout
      ? computeTrustLevel(seller.account_verification_status ?? null)
      : null;
  const createdAt = formatSaLongDate(listing.created_at);
  const categoryLabel =
    CATEGORIES.find((item) => item.value === listing.category)?.label ??
    listing.category?.replace(/_/g, " ");
  const variantCopy = getVariantCopy(listing.category);
  const sellerPhone = contactPhone(seller?.phone);
  const sellerWhatsappUrl = whatsappLink(seller?.phone, listing.title, `/listing/${listing.id}`);
  const canCall =
    showContactActions &&
    Boolean(sellerPhone) &&
    Boolean(listing.contact_methods?.includes("call"));
  const canWhatsapp =
    showContactActions &&
    Boolean(sellerWhatsappUrl) &&
    Boolean(listing.contact_methods?.includes("whatsapp"));
  const showStickyBar = layoutMode === "public" && (canCall || canWhatsapp);
  const facts = useMemo(() => buildListingFacts(listing), [listing]);
  const [viewCount, setViewCount] = useState(listing.view_count ?? 0);
  const handleViewRecorded = useCallback(() => {
    setViewCount((currentCount) => currentCount + 1);
  }, []);
  const locationLabel = [listing.location_suburb, listing.location_city, listing.location_province]
    .filter(Boolean)
    .join(", ");
  const detailFacts: DetailFact[] = [
    ...facts.map((fact) => ({ label: fact.label, value: fact.value })),
    ...(listing.location_address
      ? [{ label: "Address", value: listing.location_address, wide: true }]
      : []),
  ];
  const TitleTag = isReviewLayout ? "h2" : "h1";
  const similarHref = listing.category
    ? `/mzansi-market?category=${encodeURIComponent(listing.category)}`
    : "/mzansi-market";

  const summary = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {categoryLabel ? (
          <Badge variant="secondary" className="text-xs">
            {categoryLabel}
          </Badge>
        ) : null}
        {listing.condition ? (
          <Badge variant="outline" className="text-xs">
            {getListingConditionLabel(listing.condition)}
          </Badge>
        ) : null}
      </div>

      <TitleTag className="font-display text-[1.6rem] font-bold leading-[1.15] tracking-tight text-foreground sm:text-[2rem]">
        {listing.title}
      </TitleTag>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {listing.price_cents != null && listing.price_cents > 0 ? (
          <p className="font-display text-[2rem] font-extrabold leading-none tracking-tight text-foreground">
            {formatZARShort(listing.price_cents)}
          </p>
        ) : (
          <p className="font-display text-2xl font-bold leading-none text-foreground">
            Price on request
          </p>
        )}
        {listing.price_negotiable ? <Badge variant="verified">Negotiable</Badge> : null}
      </div>

      <ul className="space-y-1.5 text-sm text-muted-foreground">
        {locationLabel ? (
          <li className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{locationLabel}</span>
          </li>
        ) : null}
        <li className="flex items-center gap-2">
          <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Listed <time dateTime={listing.created_at}>{createdAt}</time>
          </span>
        </li>
        <li className="flex items-center gap-2">
          <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {viewCount} {viewCount === 1 ? "view" : "views"}
          </span>
        </li>
      </ul>
    </div>
  );

  const contactBlock = showContactActions ? (
    <ListingContactActions
      listingId={listing.id}
      listingTitle={listing.title}
      contactMethods={listing.contact_methods}
      sellerPhone={listing.contact_methods?.includes("call") ? (seller?.phone ?? null) : null}
      sellerWhatsapp={
        listing.contact_methods?.includes("whatsapp") ? (seller?.phone ?? null) : null
      }
    />
  ) : seller?.phone === null && seller?.masked_phone_public === null ? (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Contact seller</p>
      <p>
        <a
          href="/login"
          className="font-medium text-brand-green-700 underline dark:text-brand-green-300"
        >
          Sign in
        </a>{" "}
        to contact the seller.
      </p>
    </div>
  ) : (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Preview mode</p>
      <p>Contact buttons appear once approved.</p>
    </div>
  );

  return (
    <>
      <article
        data-layout-mode={layoutMode}
        className={cn(isReviewLayout ? REVIEW_GRID : PUBLIC_GRID, showStickyBar && "pb-24 lg:pb-0")}
      >
        <div
          className={cn(
            "min-w-0",
            isReviewLayout ? "2xl:col-start-1 2xl:row-start-1" : "lg:col-start-1 lg:row-start-1"
          )}
        >
          <ErrorBoundary
            label="ListingDetailClient"
            fallback={
              <div className="flex aspect-[4/5] items-center justify-center rounded-3xl bg-muted sm:aspect-[4/3]">
                <p className="text-sm text-muted-foreground">Image failed to load</p>
              </div>
            }
          >
            <ListingDetailClient
              photos={listing.photos ?? []}
              videos={listing.videos ?? []}
              title={listing.title}
              listingId={listing.id}
              videoThumbnail={listing.video_thumbnail}
              photoCount={photoCount}
              heroAspectClassName="aspect-[4/5] sm:aspect-[4/3]"
              heroMediaClassName="object-contain"
              trackView={trackView}
              onViewRecorded={handleViewRecorded}
            />
          </ErrorBoundary>
        </div>

        <aside
          className={cn(
            "min-w-0",
            isReviewLayout
              ? "2xl:col-start-2 2xl:row-span-2 2xl:row-start-1"
              : "lg:col-start-2 lg:row-span-2 lg:row-start-1"
          )}
        >
          <div className={cn("space-y-4", !isReviewLayout && "lg:sticky lg:top-32")}>
            {summary}

            <PosterTrustCard
              area="market"
              roleLabel="Sold by"
              name={seller?.display_name}
              trustLevel={trustLevel}
              avatar={
                listing.logo_url ? (
                  <Image
                    src={normalizeMediaUrl(listing.logo_url)}
                    alt={`${listing.title} logo`}
                    width={48}
                    height={48}
                    className="h-full w-full rounded-full object-contain"
                  />
                ) : undefined
              }
            >
              {contactBlock}
            </PosterTrustCard>

            <SafetyTipsCard
              area="market"
              className={isReviewLayout ? "hidden" : "hidden lg:block"}
            />
          </div>
        </aside>

        <div
          className={cn(
            "min-w-0 space-y-6",
            isReviewLayout ? "2xl:col-start-1 2xl:row-start-2" : "lg:col-start-1 lg:row-start-2"
          )}
        >
          {listing.description ? (
            <DetailSection title={variantCopy.aboutHeading}>
              <p className="whitespace-pre-wrap text-[15px] leading-7 text-foreground/85">
                {listing.description}
              </p>
            </DetailSection>
          ) : null}

          {detailFacts.length > 0 ? (
            <DetailSection title={variantCopy.detailsHeading}>
              <FactGrid facts={detailFacts} />
            </DetailSection>
          ) : null}

          {!isReviewLayout ? <SafetyTipsCard area="market" className="lg:hidden" /> : null}

          {showSimilarListings && similarItems.length > 0 ? (
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-xl font-semibold tracking-tight">
                  More like this
                </h2>
                <Link href={similarHref} className="link-arrow min-h-11 px-1">
                  See all
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {similarItems.map((item) => {
                  const sellerRow = similarSellers.get(readOwnerId(item) ?? "");
                  const videoUrl = item.videos?.[0];
                  return (
                    <ListingCard
                      key={item.id}
                      id={item.id}
                      title={item.title}
                      price={item.price_cents ?? 0}
                      negotiable={item.price_negotiable}
                      imageUrl={videoUrl || item.photos?.[0]}
                      posterUrl={item.video_thumbnail || item.photos?.[0] || undefined}
                      isVideo={Boolean(videoUrl)}
                      province={item.location_province}
                      city={item.location_city}
                      category={item.category}
                      attributes={item.attributes}
                      condition={item.condition ?? undefined}
                      createdAt={item.created_at}
                      ownerTrustLevel={
                        sellerRow ? computeTrustLevel(sellerRow.account_verification_status) : 0
                      }
                      viewCount={item.view_count ?? undefined}
                      featured={item.featured}
                      logoUrl={item.logo_url}
                      focalX={item.focal_x}
                      focalY={item.focal_y}
                      mediaWidth={item.media_width}
                      mediaHeight={item.media_height}
                    />
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>
      </article>

      {showStickyBar ? (
        <StickyMobileBar>
          {canCall ? (
            <Button
              type="button"
              className="h-12 flex-1 gap-2 rounded-full font-semibold"
              size="lg"
              asChild
            >
              <a href={`tel:${sellerPhone}`}>
                <Phone className="h-4 w-4" aria-hidden="true" /> Call seller
              </a>
            </Button>
          ) : null}

          {canWhatsapp && seller?.phone ? (
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 flex-1 gap-2 rounded-full border-brand-green/30 font-semibold"
            >
              <a href={sellerWhatsappUrl!} target="_blank" rel="noopener noreferrer nofollow ugc">
                <MessageCircle className="h-4 w-4 text-brand-green-600" aria-hidden="true" />
                WhatsApp
              </a>
            </Button>
          ) : null}
        </StickyMobileBar>
      ) : null}
    </>
  );
}
