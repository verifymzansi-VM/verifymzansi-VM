import { createAdminClient } from "@/lib/supabase/admin";
import {
  Megaphone,
  Flame,
  Star,
  Zap,
  ArrowRight,
  Calendar,
  Tag,
  Wrench,
  Sparkles,
  ShoppingBag,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListingCard } from "@/components/listings/listing-card";
import { PromotionCard } from "@/components/listings/promotion-card";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import Link from "next/link";
import type { SellerVerificationStatus, PromotionType } from "@/types/enums";

export const metadata = {
  title: "Promotions & Events",
  description:
    "Discover promoted listings, special deals, events and offers from verified sellers across South Africa.",
};

export const dynamic = "force-dynamic";
export const revalidate = 60;

const TYPE_CHIPS: { value: PromotionType | "all"; label: string; icon: React.ElementType }[] = [
  { value: "all", label: "All", icon: Megaphone },
  { value: "product", label: "Products", icon: ShoppingBag },
  { value: "service", label: "Services", icon: Wrench },
  { value: "event", label: "Events", icon: Calendar },
  { value: "deal", label: "Deals", icon: Tag },
  { value: "general", label: "Ads", icon: Sparkles },
];

interface PromotedListing {
  id: string;
  title: string;
  price_cents: number;
  photos: string[] | null;
  videos: string[] | null;
  location_province: string;
  location_city: string;
  category: string | null;
  created_at: string;
}

export default async function PromotionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const params = await searchParams;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const activeType = params.type || "all";

  // ── Fetch all promoted content in parallel ─────────────────
  const [featuredRes, urgentRes, boostedRes, promotionsRes] = await Promise.all([
    // Featured listings (from Mzansi Market)
    admin
      .from("listings")
      .select(
        "id, title, price_cents, photos, videos, location_province, location_city, category, created_at, featured_until, area"
      )
      .eq("status", "live")
      .gt("featured_until", now)
      .order("featured_until", { ascending: false })
      .limit(12),

    // Urgent listings
    admin
      .from("listings")
      .select(
        "id, title, price_cents, photos, videos, location_province, location_city, category, created_at, urgent_until, area"
      )
      .eq("status", "live")
      .gt("urgent_until", now)
      .order("urgent_until", { ascending: false })
      .limit(12),

    // Boosted listings
    admin
      .from("listings")
      .select(
        "id, title, price_cents, photos, videos, location_province, location_city, category, created_at, boost_until, area"
      )
      .eq("status", "live")
      .gt("boost_until", now)
      .order("boost_until", { ascending: false })
      .limit(12),

    // Promotions (unified source — includes migrated storefront_posts + business_posts)
    (() => {
      let q = admin
        .from("promotions")
        .select(
          `id, seller_id, business_id, title, description, promotion_type, category,
           photos, videos, price_cents, price_negotiable, location_province, location_city,
           start_date, end_date, boost_until, featured_until, view_count, created_at`
        )
        .eq("status", "live");

      if (activeType !== "all") {
        q = q.eq("promotion_type", activeType);
      }

      return q
        .order("boost_until", { ascending: false, nullsFirst: false })
        .order("featured_until", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(48);
    })(),
  ]);

  const featured = (featuredRes.data ?? []) as unknown as PromotedListing[];
  const urgent = (urgentRes.data ?? []) as unknown as PromotedListing[];
  const boosted = (boostedRes.data ?? []) as unknown as PromotedListing[];
  const promotions = promotionsRes.data ?? [];

  // Gather seller trust levels for promotions
  const sellerIds = [...new Set(promotions.map((p) => p.seller_id))];
  const { data: sellers } = sellerIds.length
    ? await admin
        .from("seller_profiles")
        .select("user_id, display_name, seller_verification_status")
        .in("user_id", sellerIds)
    : { data: [] };

  const sellerMap = new Map(
    (sellers ?? []).map((s) => [
      s.user_id,
      {
        name: s.display_name,
        trust: computeTrustLevel(
          (s.seller_verification_status ?? "unverified") as SellerVerificationStatus
        ),
      },
    ])
  );

  // Gather linked business names
  const businessIds = [
    ...new Set(promotions.map((p) => p.business_id).filter(Boolean)),
  ] as string[];
  const { data: businesses } = businessIds.length
    ? await admin.from("businesses").select("id, business_name").in("id", businessIds)
    : { data: [] };

  const businessMap = new Map((businesses ?? []).map((b) => [b.id, b.business_name]));

  const hasContent =
    featured.length > 0 || urgent.length > 0 || boosted.length > 0 || promotions.length > 0;

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-7xl">
      <PageHeader
        title="Promotions & Events"
        description="Deals, promotions, events and offers from verified sellers across Mzansi."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Promotions & Events" }]}
      />

      {/* ── Advertise CTA Banner ────────────────────────────── */}
      <div className="flex items-center justify-between py-3 px-4 rounded-lg bg-gradient-to-r from-brand-green/10 to-brand-gold/10 border border-brand-green/20">
        <div>
          <span className="font-semibold text-sm">Want to advertise on VerifyMzansi?</span>
          <span className="text-sm text-muted-foreground ml-2 hidden sm:inline">
            Boost listings, feature your business, or run promotions.
          </span>
        </div>
        <Button asChild size="sm" className="shrink-0 gap-1">
          <Link href="/post/create">
            Start Advertising
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </div>

      {/* ── Type filter chips ───────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {TYPE_CHIPS.map((chip) => {
          const isActive = activeType === chip.value;
          return (
            <Link
              key={chip.value}
              href={chip.value === "all" ? "/promotions" : `/promotions?type=${chip.value}`}
            >
              <Badge
                variant={isActive ? "default" : "outline"}
                className={`cursor-pointer px-3 py-1.5 text-sm gap-1.5 ${
                  isActive ? "bg-brand-green hover:bg-brand-green/90 text-white" : "hover:bg-muted"
                }`}
              >
                <chip.icon className="h-3.5 w-3.5" />
                {chip.label}
              </Badge>
            </Link>
          );
        })}
      </div>

      {!hasContent ? (
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <Megaphone className="h-8 w-8 text-muted-foreground mx-auto" />
            <h3 className="font-display text-lg font-semibold">No active promotions right now</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Check back soon for deals from verified sellers!
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Urgent Listings ───────────────────────────────── */}
          {activeType === "all" && urgent.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-red-500" />
                <h2 className="text-xl font-display font-semibold">Urgent Listings</h2>
                <Badge variant="destructive" className="text-xs">
                  Time-sensitive
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {urgent.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    id={listing.id}
                    title={listing.title}
                    price={listing.price_cents}
                    imageUrl={listing.videos?.[0] || listing.photos?.[0]}
                    province={listing.location_province}
                    city={listing.location_city}
                    category={listing.category ?? ""}
                    createdAt={listing.created_at}
                    urgent
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Featured Listings ─────────────────────────────── */}
          {activeType === "all" && featured.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500" />
                <h2 className="text-xl font-display font-semibold">Featured Listings</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {featured.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    id={listing.id}
                    title={listing.title}
                    price={listing.price_cents}
                    imageUrl={listing.videos?.[0] || listing.photos?.[0]}
                    province={listing.location_province}
                    city={listing.location_city}
                    category={listing.category ?? ""}
                    createdAt={listing.created_at}
                    featured
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Boosted Listings ──────────────────────────────── */}
          {activeType === "all" && boosted.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-orange-500" />
                <h2 className="text-xl font-display font-semibold">Boosted Listings</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {boosted.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    id={listing.id}
                    title={listing.title}
                    price={listing.price_cents}
                    imageUrl={listing.videos?.[0] || listing.photos?.[0]}
                    province={listing.location_province}
                    city={listing.location_city}
                    category={listing.category ?? ""}
                    createdAt={listing.created_at}
                    boosted
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Promotions & Ads ──────────────────────────────── */}
          {promotions.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Megaphone className="h-5 w-5 text-brand-green" />
                <h2 className="text-xl font-display font-semibold">
                  {activeType === "all"
                    ? "All Promotions & Ads"
                    : activeType === "event"
                      ? "Events"
                      : activeType === "deal"
                        ? "Deals"
                        : activeType === "product"
                          ? "Products"
                          : activeType === "service"
                            ? "Services"
                            : "Ads"}
                </h2>
                <Badge variant="secondary">{promotions.length}</Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {promotions.map((promo) => {
                  const seller = sellerMap.get(promo.seller_id);
                  const businessName = promo.business_id
                    ? businessMap.get(promo.business_id)
                    : undefined;
                  const nowDate = new Date();
                  const isBoosted = promo.boost_until
                    ? new Date(promo.boost_until) > nowDate
                    : false;
                  const isFeatured = promo.featured_until
                    ? new Date(promo.featured_until) > nowDate
                    : false;

                  return (
                    <div key={promo.id} className="space-y-1">
                      <PromotionCard
                        id={promo.id}
                        title={promo.title}
                        price={promo.price_cents}
                        negotiable={promo.price_negotiable}
                        imageUrl={promo.photos?.[0] || promo.videos?.[0]}
                        province={promo.location_province}
                        city={promo.location_city}
                        promotionType={promo.promotion_type as PromotionType}
                        createdAt={promo.created_at}
                        sellerTrustLevel={seller?.trust}
                        sellerName={seller?.name}
                        viewCount={promo.view_count}
                        boosted={isBoosted}
                        featured={isFeatured}
                        endDate={promo.end_date}
                      />
                      {businessName && (
                        <p className="px-2 text-xs text-brand-blue font-medium truncate">
                          by {businessName}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
