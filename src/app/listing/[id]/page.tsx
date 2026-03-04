import { notFound } from "next/navigation";
import Link from "next/link";
import { MapPin, Calendar, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { TrustBadge } from "@/components/trust/trust-badge";
import { ListingCard } from "@/components/listings/listing-card";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import type { SellerVerificationStatus } from "@/types/enums";
import { formatZAR } from "@/lib/utils/format";
import { CATEGORIES } from "@/lib/constants/categories";
import { ListingDetailClient } from "./client";
import { ListingContactActions } from "./listing-contact-actions";
import type { Metadata } from "next";

interface SimilarListingRow {
  id: string;
  title: string;
  price_cents: number | null;
  price_negotiable: boolean;
  photos: string[];
  location_province: string;
  location_city: string;
  category: string;
  attributes: Record<string, unknown>;
  created_at: string;
  boost_until: string | null;
  featured: boolean;
  seller_id: string;
}

interface SimilarSellerRow {
  user_id: string;
  display_name: string;
  seller_verification_status: string;
}

interface ListingDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ListingDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: listing } = await supabase
    .from("listings")
    .select("title, description")
    .eq("id", id)
    .single();

  if (!listing) {
    return { title: "Listing Not Found" };
  }

  return {
    title: `${listing.title} | Mzansi Market`,
    description: listing.description?.slice(0, 160),
  };
}

export default async function ListingDetailPage({ params }: ListingDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  // Fetch listing
  const { data: listing } = await supabase
    .from("listings")
    .select("*")
    .eq("id", id)
    .eq("status", "live")
    .single();

  if (!listing) notFound();

  // Fetch seller profile (maybeSingle — seller account may have been deleted)
  const { data: seller } = await supabase
    .from("seller_profiles")
    .select(
      "id, display_name, location_province, location_city, seller_verification_status, phone, masked_phone_public"
    )
    .eq("user_id", listing.seller_id)
    .maybeSingle();

  // Track view
  supabase
    .from("listing_views")
    .insert({ target_id: listing.id, target_type: "listing" })
    .then(() => {});

  // Fetch similar listings (same category, excluding current)
  const { data: similarListings } = await supabase
    .from("listings")
    .select(
      "id, title, price_cents, price_negotiable, photos, location_province, location_city, category, attributes, created_at, boost_until, featured, seller_id"
    )
    .eq("status", "live")
    .eq("area", "MZANSI_MARKET")
    .eq("category", listing.category)
    .neq("id", listing.id)
    .order("created_at", { ascending: false })
    .limit(4);

  // Fetch seller profiles for similar listings
  const similarItems = (similarListings ?? []) as SimilarListingRow[];
  let similarSellers = new Map<string, SimilarSellerRow>();
  if (similarItems.length > 0) {
    const sellerIds = Array.from(new Set(similarItems.map((l) => l.seller_id)));
    const { data: sellerData } = await supabase
      .from("seller_profiles")
      .select("user_id, display_name, seller_verification_status")
      .in("user_id", sellerIds);
    similarSellers = new Map((sellerData ?? []).map((s) => [s.user_id, s]));
  }

  const trustLevel = seller
    ? computeTrustLevel(seller.seller_verification_status ?? "unverified")
    : null;

  const createdAt = new Date(listing.created_at).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const _allMedia: string[] = [...(listing.photos ?? []), ...(listing.videos ?? [])];
  const sellerInitial = seller?.display_name?.charAt(0)?.toUpperCase() || "S";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    description: listing.description?.slice(0, 300),
    ...(listing.photos?.[0] && { image: listing.photos[0] }),
    offers: {
      "@type": "Offer",
      priceCurrency: "ZAR",
      price: listing.price_cents ? (listing.price_cents / 100).toFixed(2) : "0",
      availability: "https://schema.org/InStock",
      seller: seller ? { "@type": "Person", name: seller.display_name } : undefined,
    },
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="flex-1">
        <div className="container-page py-4 space-y-5">
          <PageHeader
            title={listing.title}
            breadcrumbs={[
              { label: "Mzansi Market", href: "/mzansi-market" },
              { label: listing.title },
            ]}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* ── Image Gallery ──────────────────────── */}
              <ListingDetailClient
                photos={listing.photos ?? []}
                videos={listing.videos ?? []}
                title={listing.title}
                listingId={listing.id}
                videoThumbnail={listing.video_thumbnail}
              />

              {/* Price & Details */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  {listing.price_cents != null && (
                    <p className="text-3xl font-bold font-display text-brand-green">
                      {formatZAR(listing.price_cents)}
                    </p>
                  )}
                  {listing.price_negotiable && (
                    <Badge className="bg-brand-green/10 text-brand-green text-xs">Negotiable</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {createdAt}
                  </span>
                  <span className="flex items-center gap-1">
                    <Eye className="h-4 w-4" />
                    Views
                  </span>
                </div>
              </div>

              {/* Category & Condition */}
              <div className="flex flex-wrap items-center gap-2">
                {listing.category && (
                  <Badge variant="secondary" className="capitalize">
                    {listing.category.replace(/_/g, " ")}
                  </Badge>
                )}
                {listing.attributes?.condition && (
                  <Badge variant="outline" className="capitalize">
                    {listing.attributes.condition.replace(/_/g, " ")}
                  </Badge>
                )}
                {listing.contact_methods?.map((m: string) => (
                  <Badge key={m} variant="outline" className="text-xs capitalize">
                    {m}
                  </Badge>
                ))}
              </div>

              {/* ── Category-specific Attributes ──────── */}
              {listing.attributes &&
                Object.keys(listing.attributes).filter((k) => k !== "condition").length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <h2 className="font-display text-lg font-semibold">Details</h2>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        {(() => {
                          const catDef = CATEGORIES.find((c) => c.value === listing.category);
                          const attrEntries = Object.entries(
                            listing.attributes as Record<string, unknown>
                          ).filter(
                            ([k, v]) =>
                              k !== "condition" && v !== "" && v !== null && v !== undefined
                          );

                          return attrEntries.map(([key, value]) => {
                            const fieldDef = catDef?.attributeFields.find((f) => f.name === key);
                            const label = fieldDef?.label ?? key.replace(/_/g, " ");
                            let displayValue: string;
                            if (typeof value === "boolean") {
                              displayValue = value ? "Yes" : "No";
                            } else if (fieldDef?.unit) {
                              displayValue = `${value} ${fieldDef.unit}`;
                            } else {
                              displayValue = String(value);
                            }
                            return (
                              <div key={key} className="flex justify-between gap-2">
                                <span className="text-muted-foreground capitalize">{label}</span>
                                <span className="font-medium text-right">{displayValue}</span>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  </>
                )}

              <Separator />

              {/* Description */}
              <div className="space-y-2">
                <h2 className="font-display text-lg font-semibold">Description</h2>
                <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {listing.description}
                </p>
              </div>

              {/* Location */}
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
                </>
              )}
            </div>

            {/* ── Sidebar — Seller Info & Contact ──────── */}
            <div className="space-y-4">
              <Card className="border-2">
                <CardContent className="p-6 space-y-4">
                  <h3 className="font-display font-semibold">Seller</h3>
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-brand-green text-white text-lg font-bold flex items-center justify-center shadow-sm">
                      {sellerInitial}
                    </div>
                    <div>
                      <p className="font-semibold">{seller?.display_name || "Seller"}</p>
                      {trustLevel && <TrustBadge level={trustLevel} size="sm" />}
                    </div>
                  </div>

                  {seller?.location_city && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {[seller.location_city, seller.location_province].filter(Boolean).join(", ")}
                    </p>
                  )}

                  <Separator />

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
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ── Similar Listings ───────────────────────── */}
          {similarItems.length > 0 && (
            <section className="space-y-4 pt-4">
              <Separator />
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-semibold">Similar Listings</h2>
                <Link
                  href={`/mzansi-market?category=${listing.category}`}
                  className="text-sm font-medium text-brand-green hover:text-brand-green/80 transition-colors"
                >
                  View all →
                </Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {similarItems.map((item) => {
                  const itemSeller = similarSellers.get(item.seller_id);
                  const itemTrust = computeTrustLevel(
                    (itemSeller?.seller_verification_status ??
                      null) as SellerVerificationStatus | null
                  );
                  return (
                    <ListingCard
                      key={item.id}
                      id={item.id}
                      title={item.title}
                      price={item.price_cents ?? 0}
                      negotiable={item.price_negotiable}
                      imageUrl={item.photos?.[0]}
                      province={item.location_province}
                      city={item.location_city}
                      category={item.category}
                      condition={item.attributes?.condition as string | undefined}
                      createdAt={item.created_at}
                      sellerTrustLevel={itemTrust}
                      sellerName={itemSeller?.display_name}
                      boosted={item.boost_until ? new Date(item.boost_until) > new Date() : false}
                      featured={item.featured}
                    />
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
