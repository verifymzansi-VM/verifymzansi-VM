"use client";

import { BrandShield as ShieldCheck } from "@/components/shared/brand-shield";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Calendar, Eye, MapPin, Phone, MessageCircle } from "lucide-react";
import { contactPhone, whatsappLink } from "@/lib/utils/contact-links";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TrustBadge } from "@/components/trust/trust-badge";
import { ListingCard } from "@/components/listings/listing-card";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { readOwnerId } from "@/lib/account/compat";
import { formatRandAmount, formatSaLongDate, formatZAR } from "@/lib/utils/format";
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

const CONTACT_METHOD_LABELS: Record<string, string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  form: "Enquiry form",
  in_app: "Enquiry form",
};

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
      return { detailsHeading: "Property details" };
    case "motors":
      return { detailsHeading: "Vehicle details" };
    case "services":
      return { detailsHeading: "Service details" };
    default:
      return { detailsHeading: "Listing details" };
  }
}

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
  // Create/edit previews already have a page h1.
  const TitleTag = isReviewLayout ? "h2" : "h1";
  // Previews show the poster's own account; the trust badge only makes sense publicly.
  const trustLevel =
    seller && !isReviewLayout
      ? computeTrustLevel(seller.account_verification_status ?? null)
      : null;
  const createdAt = formatSaLongDate(listing.created_at);
  const categoryLabel =
    CATEGORIES.find((item) => item.value === listing.category)?.label ??
    (listing.category ? humanizeKey(listing.category) : null);
  const contactMethodLabels = Array.from(
    new Set(
      (listing.contact_methods ?? []).map(
        (method) => CONTACT_METHOD_LABELS[method] ?? humanizeKey(method)
      )
    )
  );
  const variantCopy = getVariantCopy(listing.category);
  const sellerInitial = seller?.display_name?.charAt(0)?.toUpperCase() || "S";
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
  const quickFacts = facts.slice(0, 6);
  const detailFacts = facts.slice(6);
  const handleViewRecorded = useCallback(() => {
    setViewCount((currentCount) => currentCount + 1);
  }, []);

  return (
    <>
      <article
        data-layout-mode={layoutMode}
        className={
          isReviewLayout
            ? "grid grid-cols-1 gap-6"
            : showStickyBar
              ? "grid grid-cols-1 gap-6 pb-24 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(18rem,20rem)] lg:items-start lg:pb-0"
              : "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(18rem,20rem)] lg:items-start"
        }
      >
        <div
          className={
            isReviewLayout
              ? "space-y-6 2xl:grid 2xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] 2xl:items-start 2xl:gap-8 2xl:space-y-0"
              : "space-y-6 lg:col-span-2 lg:grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start lg:gap-8 lg:space-y-0"
          }
        >
          <div
            className={`mx-auto w-full max-w-[280px] sm:max-w-[320px] ${
              isReviewLayout ? "2xl:max-w-none" : "lg:max-w-none"
            }`}
          >
            <ErrorBoundary
              label="ListingDetailClient"
              fallback={
                <div className="aspect-[9/16] rounded-[28px] bg-muted flex items-center justify-center">
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
                heroAspectClassName="aspect-[9/16]"
                heroMediaClassName="bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.22),_rgba(15,23,42,0.96))] object-contain transition-transform duration-500"
                trackView={trackView}
                onViewRecorded={handleViewRecorded}
              />
            </ErrorBoundary>
          </div>

          <div className="space-y-5">
            <div className="space-y-3 text-center lg:text-left">
              <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                {categoryLabel ? (
                  <Badge variant="outline" className="text-[11px]">
                    {categoryLabel}
                  </Badge>
                ) : null}
                {listing.condition ? (
                  <Badge variant="secondary" className="text-[11px]">
                    {getListingConditionLabel(listing.condition)}
                  </Badge>
                ) : null}
                {contactMethodLabels.map((label) => (
                  <Badge key={label} variant="outline" className="text-[11px]">
                    {label}
                  </Badge>
                ))}
              </div>

              <TitleTag className="break-words font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
                {listing.title}
              </TitleTag>

              <div className="flex flex-wrap items-end justify-center gap-3 lg:justify-start">
                {listing.price_cents != null && listing.price_cents > 0 ? (
                  <p className="font-display text-[2rem] font-bold leading-none tracking-tight text-brand-green">
                    {formatZAR(listing.price_cents)}
                  </p>
                ) : (
                  <p className="font-display text-2xl font-bold leading-none tracking-tight text-brand-green">
                    {listing.category === "jobs_services"
                      ? "Salary not provided"
                      : "Price on request"}
                  </p>
                )}
                {listing.price_negotiable ? (
                  <Badge className="bg-brand-green/10 text-brand-green">Negotiable</Badge>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground lg:justify-start">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  <time dateTime={listing.created_at}>{createdAt}</time>
                </span>
                <span className="flex items-center gap-1">
                  <Eye className="h-4 w-4" />
                  {viewCount} {viewCount === 1 ? "view" : "views"}
                </span>
              </div>
            </div>

            {quickFacts.length > 0 ? (
              <Card className="surface-card elev-sm">
                <CardContent className="space-y-4 p-5">
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Quick Facts
                    </p>
                    <h2 className="font-display text-xl font-semibold">
                      {variantCopy.detailsHeading}
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {quickFacts.map((fact) => (
                      <div
                        key={`${fact.label}-${fact.value}`}
                        className="rounded-2xl border border-slate-200/70 bg-slate-50/90 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]"
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          {fact.label}
                        </p>
                        <p className="mt-1 text-sm font-medium">{fact.value}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {listing.description ? (
              <Card className="surface-card elev-sm">
                <CardContent className="space-y-3 p-5">
                  <h2 className="font-display text-lg font-semibold">Description</h2>
                  <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                    {listing.description}
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {(listing.location_province ||
              listing.location_city ||
              listing.location_suburb ||
              listing.location_address) && (
              <Card className="surface-card elev-sm">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-brand-green" />
                    <div>
                      <p className="font-medium">
                        {[listing.location_suburb, listing.location_city, listing.location_province]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                      <p className="text-xs text-muted-foreground">Listed location</p>
                    </div>
                  </div>
                  {listing.location_address ? (
                    <p className="text-sm text-muted-foreground">{listing.location_address}</p>
                  ) : null}
                </CardContent>
              </Card>
            )}
          </div>

          {detailFacts.length > 0 ? (
            <Card className="surface-card elev-sm lg:col-span-2">
              <CardContent className="space-y-4 p-5">
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    More Details
                  </p>
                  <h2 className="font-display text-xl font-semibold">Full listing breakdown</h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {detailFacts.map((fact) => (
                    <div
                      key={`${fact.label}-${fact.value}`}
                      className="flex items-start justify-between gap-3 rounded-2xl bg-muted/40 px-3 py-2"
                    >
                      <p className="text-sm text-muted-foreground">{fact.label}</p>
                      <p className="text-right text-sm font-medium">{fact.value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {showSimilarListings && similarItems.length > 0 ? (
            <div className="space-y-3 lg:col-span-2">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Keep Browsing
                  </p>
                  <h2 className="font-display text-xl font-semibold">Similar listings</h2>
                </div>
                <Link
                  href="/mzansi-market"
                  className="text-sm font-medium text-brand-green hover:underline"
                >
                  View all
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(auto-fill,minmax(0,15rem))]">
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
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card className="surface-card elev-sm">
            <CardContent className="space-y-4 p-5">
              <h2 className="font-display text-lg font-semibold">Seller</h2>

              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-green text-lg font-bold text-white">
                  {sellerInitial}
                </div>
                <div className="min-w-0">
                  <p className="break-words font-medium">
                    {seller?.display_name || "Account name unavailable"}
                  </p>
                  {trustLevel ? <TrustBadge level={trustLevel} size="sm" /> : null}
                </div>
              </div>

              {seller?.location_city || seller?.location_province ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  <span>
                    {[seller.location_city, seller.location_province].filter(Boolean).join(", ")}
                  </span>
                </div>
              ) : null}

              <Separator />

              {showContactActions ? (
                <ListingContactActions
                  listingId={listing.id}
                  listingTitle={listing.title}
                  contactMethods={listing.contact_methods}
                  sellerPhone={
                    listing.contact_methods?.includes("call") ? (seller?.phone ?? null) : null
                  }
                  sellerWhatsapp={
                    listing.contact_methods?.includes("whatsapp") ? (seller?.phone ?? null) : null
                  }
                />
              ) : seller?.phone === null && seller?.masked_phone_public === null ? (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Contact seller</p>
                  <p>
                    <a href="/login" className="font-medium text-brand-green hover:underline">
                      Sign in
                    </a>{" "}
                    to reveal contact options for this listing.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Preview mode</p>
                  <p>Contact buttons will appear publicly after approval.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="surface-card elev-sm">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center gap-3">
                <span className="icon-tile bg-brand-green/10 text-brand-green dark:text-brand-green-300">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="font-display text-base font-semibold">Stay safe when you meet</h3>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Meet in a public place, check the item before paying, and never share OTPs or
                upfront deposits with strangers.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                <Link href="/safety/meeting-checklist" prefetch={false} className="link-arrow">
                  Meeting checklist
                </Link>
                <Link href="/safety/scam-alerts" prefetch={false} className="link-arrow">
                  Scam alerts
                </Link>
              </div>
            </CardContent>
          </Card>

          {listing.logo_url ? (
            <Card className="surface-card elev-sm">
              <CardContent className="flex items-center gap-3 p-5">
                <div className="h-12 w-12 overflow-hidden rounded-2xl border bg-white p-1 dark:bg-warm-900">
                  <Image
                    src={normalizeMediaUrl(listing.logo_url)}
                    alt={`${listing.title} logo`}
                    width={48}
                    height={48}
                    className="h-full w-full rounded-xl object-contain"
                  />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Brand
                  </p>
                  <p className="font-medium">Shown on the marketplace card and detail page</p>
                </div>
              </CardContent>
            </Card>
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
                <Phone className="h-4 w-4" /> Call seller
              </a>
            </Button>
          ) : null}

          {canWhatsapp && seller?.phone ? (
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 flex-1 gap-2 rounded-full border-green-500/30 font-semibold"
            >
              <a href={sellerWhatsappUrl!} target="_blank" rel="noopener noreferrer nofollow ugc">
                <MessageCircle className="h-4 w-4 text-green-600" />
                WhatsApp
              </a>
            </Button>
          ) : null}
        </StickyMobileBar>
      ) : null}
    </>
  );
}
