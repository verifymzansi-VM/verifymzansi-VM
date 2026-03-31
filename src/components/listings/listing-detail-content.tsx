"use client";

import Link from "next/link";
import { Calendar, Eye, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  created_at: string;
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
  logo_url?: string | null;
  location_province: string;
  location_city: string;
  category: string;
  attributes: Record<string, unknown>;
  created_at: string;
  boost_until: string | null;
  featured: boolean;
  owner_id?: string | null;
}

export interface SimilarSellerRow {
  user_id: string;
  display_name: string;
  account_verification_status: AccountVerificationStatus | null;
}

export function ListingDetailContent({
  listing,
  seller,
  showContactActions = true,
  showSimilarListings = true,
  similarItems = [],
  similarSellers = new Map<string, SimilarSellerRow>(),
  photoCount,
}: {
  listing: ListingDetailRecord;
  seller: ListingSellerRecord | null;
  showContactActions?: boolean;
  showSimilarListings?: boolean;
  similarItems?: SimilarListingRow[];
  similarSellers?: Map<string, SimilarSellerRow>;
  /** When set, passed to the carousel so blob preview URLs can be identified as video by position. */
  photoCount?: number;
}) {
  const trustLevel = seller ? computeTrustLevel(seller.account_verification_status ?? null) : null;
  const createdAt = new Date(listing.created_at).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const sellerInitial = seller?.display_name?.charAt(0)?.toUpperCase() || "S";

  return (
    <>
      <article className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ErrorBoundary
            label="ListingDetailClient"
            fallback={
              <div className="aspect-video rounded-xl bg-muted flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Media preview failed to render</p>
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
            />
          </ErrorBoundary>

          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-baseline gap-2">
              {listing.price_cents != null && (
                <p className="font-display text-2xl font-bold text-brand-green">
                  {formatZAR(listing.price_cents)}
                </p>
              )}
              {listing.price_negotiable && (
                <Badge className="bg-brand-green/10 text-xs text-brand-green">Negotiable</Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                <time dateTime={listing.created_at}>{createdAt}</time>
              </span>
              <span className="flex items-center gap-1">
                <Eye className="h-4 w-4" />
                Views
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {listing.category && (
              <Badge variant="secondary" className="capitalize">
                {listing.category.replace(/_/g, " ")}
              </Badge>
            )}
            {listing.condition && (
              <Badge variant="outline" className="capitalize">
                {getListingConditionLabel(listing.condition)}
              </Badge>
            )}
            {listing.contact_methods?.map((method) => (
              <Badge key={method} variant="outline" className="text-xs capitalize">
                {method}
              </Badge>
            ))}
          </div>

          {listing.attributes &&
            Object.keys(listing.attributes).filter((key) => key !== "condition").length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h2 className="font-display text-lg font-semibold">Details</h2>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    {(() => {
                      const categoryDefinition = CATEGORIES.find(
                        (item) => item.value === listing.category
                      );
                      const attributeEntries = Object.entries(listing.attributes ?? {}).filter(
                        ([key, value]) =>
                          key !== "condition" &&
                          value !== "" &&
                          value !== null &&
                          value !== undefined
                      );

                      return attributeEntries.map(([key, value]) => {
                        const fieldDefinition = categoryDefinition?.attributeFields.find(
                          (field) => field.name === key
                        );
                        const label = fieldDefinition?.label ?? key.replace(/_/g, " ");
                        let displayValue: string;

                        if (typeof value === "boolean") {
                          displayValue = value ? "Yes" : "No";
                        } else if (fieldDefinition?.unit) {
                          displayValue = `${value} ${fieldDefinition.unit}`;
                        } else {
                          displayValue = String(value);
                        }

                        return (
                          <div key={key} className="flex justify-between gap-2">
                            <dt className="capitalize text-muted-foreground">{label}</dt>
                            <dd className="text-right font-medium">{displayValue}</dd>
                          </div>
                        );
                      });
                    })()}
                  </dl>
                </div>
              </>
            )}

          <Separator />

          <div className="space-y-2">
            <h2 className="font-display text-lg font-semibold">Description</h2>
            <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
              {listing.description}
            </p>
          </div>

          {(listing.location_province || listing.location_city) && (
            <>
              <Separator />
              <div className="flex items-center gap-2 text-sm">
                <div className="rounded-full bg-brand-green/10 p-2">
                  <MapPin className="h-4 w-4 text-brand-green" />
                </div>
                <div>
                  <p className="font-medium">
                    {[listing.location_suburb, listing.location_city, listing.location_province]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                  <p className="text-xs text-muted-foreground">Listed location</p>
                </div>
              </div>
              {listing.location_address && (
                <p className="ml-12 text-sm text-muted-foreground">{listing.location_address}</p>
              )}
            </>
          )}
        </div>

        <div className="space-y-4">
          <Card className="border-2">
            <CardContent className="space-y-4 p-6">
              <h3 className="font-display font-semibold">Seller</h3>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-green text-lg font-bold text-white shadow-sm">
                  {sellerInitial}
                </div>
                <div>
                  <p className="font-semibold">{seller?.display_name || "Seller"}</p>
                  {trustLevel && <TrustBadge level={trustLevel} size="sm" />}
                </div>
              </div>

              {seller?.location_city && (
                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {[seller.location_city, seller.location_province].filter(Boolean).join(", ")}
                </p>
              )}

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
                    <a href="/login" className="text-brand-green hover:underline font-medium">
                      Sign in
                    </a>{" "}
                    to see the seller&apos;s contact details.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Creator preview</p>
                  <p>
                    Public contact buttons appear after approval. This preview still shows the saved
                    contact methods above.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </article>

      {showSimilarListings && similarItems.length > 0 && (
        <section aria-label="Similar listings" className="space-y-4 pt-4">
          <Separator />
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">Similar Listings</h2>
            <Link
              href={`/mzansi-market?category=${listing.category}`}
              className="text-sm font-medium text-brand-green transition-colors hover:text-brand-green/80"
            >
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {similarItems.map((item) => {
              const itemOwnerId = readOwnerId(item);
              const itemSeller = itemOwnerId ? similarSellers.get(itemOwnerId) : undefined;
              const itemTrust = computeTrustLevel(itemSeller?.account_verification_status ?? null);

              return (
                <ListingCard
                  key={item.id}
                  id={item.id}
                  title={item.title}
                  price={item.price_cents ?? 0}
                  negotiable={item.price_negotiable}
                  imageUrl={item.photos?.[0]}
                  logoUrl={item.logo_url}
                  province={item.location_province}
                  city={item.location_city}
                  category={item.category}
                  attributes={item.attributes}
                  condition={item.condition ?? undefined}
                  createdAt={item.created_at}
                  ownerTrustLevel={itemTrust}
                  ownerName={itemSeller?.display_name}
                  boosted={item.boost_until ? new Date(item.boost_until) > new Date() : false}
                  featured={item.featured}
                />
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
