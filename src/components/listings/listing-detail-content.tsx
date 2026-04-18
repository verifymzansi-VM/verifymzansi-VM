"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Calendar, Eye, MapPin, Phone, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TrustBadge } from "@/components/trust/trust-badge";
import { ListingCard } from "@/components/listings/listing-card";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { readOwnerId } from "@/lib/account/compat";
import { formatZAR } from "@/lib/utils/format";
import { CATEGORIES } from "@/lib/constants/categories";
import { ListingDetailClient } from "@/app/listing/[id]/client";
import { ListingContactActions } from "@/app/listing/[id]/listing-contact-actions";
import { getListingConditionLabel } from "@/lib/constants/listing-condition";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { resolveMarketProfileVariant } from "@/lib/presentation/profile-variants";
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

function formatFactValue(value: unknown, unit?: string) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).replace(/_/g, " ")).join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (value == null) {
    return "";
  }
  return unit ? `${String(value)} ${unit}` : String(value).replace(/_/g, " ");
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
          value: formatFactValue(rawValue, field.unit),
        };
      })
      .filter((fact): fact is FactItem => Boolean(fact)) ?? [];

  const fallbackFacts = Object.entries(listing.attributes ?? {})
    .map(([key, value]) => {
      if (value === "" || value == null || (Array.isArray(value) && value.length === 0)) {
        return null;
      }
      return { label: key.replace(/_/g, " "), value: formatFactValue(value) };
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
      return {
        eyebrow: "Property Snapshot",
        title: "The key home details first",
        detailsHeading: "Property details",
      };
    case "motors":
      return {
        eyebrow: "Vehicle Snapshot",
        title: "Specs, condition, and sale details",
        detailsHeading: "Vehicle details",
      };
    case "services":
      return {
        eyebrow: "Service Snapshot",
        title: "What the offer includes",
        detailsHeading: "Service details",
      };
    default:
      return {
        eyebrow: "Listing Snapshot",
        title: "The main details shoppers look for",
        detailsHeading: "Listing details",
      };
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
  const trustLevel = seller ? computeTrustLevel(seller.account_verification_status ?? null) : null;
  const createdAt = new Date(listing.created_at).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const variantCopy = getVariantCopy(listing.category);
  const sellerInitial = seller?.display_name?.charAt(0)?.toUpperCase() || "S";
  const [showStickyContact, setShowStickyContact] = useState(false);
  const canCall =
    showContactActions &&
    Boolean(seller?.masked_phone_public) &&
    Boolean(listing.contact_methods?.includes("call"));
  const canWhatsapp =
    showContactActions &&
    Boolean(seller?.phone) &&
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
                <Badge variant="outline" className="text-[11px]">
                  {listing.category?.replace(/_/g, " ")}
                </Badge>
                {listing.condition ? (
                  <Badge variant="secondary" className="text-[11px]">
                    {getListingConditionLabel(listing.condition)}
                  </Badge>
                ) : null}
                {listing.contact_methods?.map((method) => (
                  <Badge key={method} variant="outline" className="text-[11px] capitalize">
                    {method}
                  </Badge>
                ))}
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  {variantCopy.eyebrow}
                </p>
                <h2 className="font-display text-2xl font-semibold tracking-tight">
                  {variantCopy.title}
                </h2>
              </div>

              <div className="flex flex-wrap items-end justify-center gap-3 lg:justify-start">
                {listing.price_cents != null ? (
                  <p className="font-display text-3xl font-bold text-brand-green">
                    {formatZAR(listing.price_cents)}
                  </p>
                ) : null}
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
              <Card className="border-slate-200/75 bg-white/95 shadow-[0_20px_50px_-36px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-slate-950/75">
                <CardContent className="space-y-4 p-5">
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Quick Facts
                    </p>
                    <h3 className="font-display text-xl font-semibold">
                      {variantCopy.detailsHeading}
                    </h3>
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
              <Card className="border-slate-200/75 bg-white/95 shadow-[0_20px_50px_-36px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-slate-950/75">
                <CardContent className="space-y-3 p-5">
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Description
                    </p>
                    <h3 className="font-display text-xl font-semibold">What buyers should know</h3>
                  </div>
                  <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                    {listing.description}
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {(listing.location_province || listing.location_city) && (
              <Card className="border-slate-200/75 bg-white/95 shadow-[0_20px_50px_-36px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-slate-950/75">
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
            <Card className="border-slate-200/75 bg-white/95 shadow-[0_20px_50px_-36px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-slate-950/75 lg:col-span-2">
              <CardContent className="space-y-4 p-5">
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    More Details
                  </p>
                  <h3 className="font-display text-xl font-semibold">Full listing breakdown</h3>
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
                  <h3 className="font-display text-xl font-semibold">Similar listings</h3>
                </div>
                <Link
                  href="/mzansi-market"
                  className="text-sm font-medium text-brand-green hover:underline"
                >
                  View all
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                      likeCount={typeof item.like_count === "number" ? item.like_count : undefined}
                      viewerHasLiked={item.viewer_has_liked ?? false}
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
          <Card className="border-slate-200/75 bg-white/95 shadow-[0_20px_50px_-36px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-slate-950/75">
            <CardContent className="space-y-4 p-5">
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Seller
                </p>
                <h3 className="font-display text-lg font-semibold">Verified seller profile</h3>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-green text-lg font-bold text-white">
                  {sellerInitial}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium">{seller?.display_name || "Seller"}</p>
                  {trustLevel ? <TrustBadge level={trustLevel} size="sm" /> : null}
                </div>
              </div>

              {seller?.location_city ? (
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
                  sellerPhone={
                    listing.contact_methods?.includes("call")
                      ? (seller?.masked_phone_public ?? null)
                      : null
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

          {listing.logo_url ? (
            <Card className="border-slate-200/75 bg-white/95 shadow-[0_20px_50px_-36px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-slate-950/75">
              <CardContent className="flex items-center gap-3 p-5">
                <div className="h-12 w-12 overflow-hidden rounded-2xl border bg-white p-1 dark:bg-warm-900">
                  <Image
                    src={listing.logo_url}
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
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur-md lg:hidden">
          <div className="mx-auto flex max-w-lg gap-3">
            {canCall ? (
              <Button
                type="button"
                className="flex-1 gap-2"
                size="lg"
                onClick={() => setShowStickyContact(true)}
              >
                <Phone className="h-4 w-4" />
                {showStickyContact && seller?.masked_phone_public
                  ? seller.masked_phone_public
                  : "Show Contact"}
              </Button>
            ) : null}

            {canWhatsapp && seller?.phone ? (
              <Button
                asChild
                size="lg"
                variant="outline"
                className="flex-1 gap-2 border-green-500/30"
              >
                <a
                  href={`https://wa.me/${seller.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                >
                  <Sparkles className="h-4 w-4 text-green-600" />
                  WhatsApp
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
