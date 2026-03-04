import { createClient } from "@/lib/supabase/server";
import { ShowroomHero, type ShowroomSlide } from "@/components/showrooms/showroom-hero";
import { PageHeader } from "@/components/layout/page-header";
import { TrustStrip } from "@/components/layout/trust-strip";
import { ListingFilters } from "@/components/listings/listing-filters";
import { ListingFilterSidebar } from "@/components/listings/listing-filter-sidebar";
import { CategoryStrip } from "@/components/listings/category-strip";
import { ListingGridHeader } from "@/components/listings/listing-grid-header";
import { MzansiMarketGrid } from "./grid";
import { MarketplaceUrlFilterSync } from "./url-filter-sync";
import { normalizeMediaUrl } from "@/lib/utils/media-url";

export const metadata = {
  title: "Mzansi Market",
  description:
    "Browse verified classified ads for property, cars, electronics and more across South Africa.",
};

/** Revalidate marketplace data every 60 seconds (ISR) */
export const revalidate = 60;

export default async function MzansiMarketPage() {
  const supabase = await createClient();

  const { data: listings } = await supabase
    .from("listings")
    .select(
      "id, title, description, price_cents, photos, videos, video_thumbnail, location_province, location_city, boost_until"
    )
    .eq("status", "live")
    .eq("area", "MZANSI_MARKET")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5);

  const slides: ShowroomSlide[] = (listings ?? []).map((l) => ({
    type: "listing",
    id: l.id,
    title: l.title,
    description: l.description || "Exclusive verified listing.",
    location: l.location_city || l.location_province || "South Africa",
    mediaUrl: normalizeMediaUrl(
      l.videos && l.videos.length > 0
        ? l.videos[0]
        : l.photos && l.photos.length > 0
          ? l.photos[0]
          : "https://images.unsplash.com/photo-1593642632823-8f785ba67e45?w=1600&q=80"
    ),
    posterUrl: l.video_thumbnail
      ? normalizeMediaUrl(l.video_thumbnail)
      : l.photos && l.photos.length > 0
        ? normalizeMediaUrl(l.photos[0])
        : undefined,
    price: l.price_cents ? l.price_cents / 100 : null,
    promotions: [],
  }));

  return (
    <div className="space-y-0">
      <MarketplaceUrlFilterSync />

      {/* ── Dynamic Showroom Hero ──────────────────────────────────── */}
      <ShowroomHero
        slides={slides}
        fallbackTitle="Mzansi Market Showroom"
        fallbackDescription="An exclusive showroom for classified ads. Browse products and items natively listed on Mzansi Market by identity-verified sellers."
      />

      <TrustStrip variant="green" />

      {/* ── Main Content ─────────────────────────────────── */}
      <div className="container-page py-6 space-y-4">
        <PageHeader
          title="Browse Listings"
          description="Find great deals from verified sellers across South Africa."
          breadcrumbs={[{ label: "Mzansi Market" }]}
        />

        {/* Category pills */}
        <CategoryStrip />

        {/* Two-column layout */}
        <div className="flex gap-6">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-64 shrink-0">
            <ListingFilterSidebar />
          </aside>

          {/* Main content area */}
          <div className="flex-1 min-w-0">
            {/* Mobile: search + filter dialog */}
            <div className="lg:hidden mb-4">
              <ListingFilters />
            </div>

            {/* Toolbar: location + sort + active chips */}
            <ListingGridHeader />

            {/* Listings grid */}
            <MzansiMarketGrid />
          </div>
        </div>
      </div>
    </div>
  );
}
