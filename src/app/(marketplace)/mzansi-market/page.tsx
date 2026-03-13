import type { Metadata } from "next";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ShowroomHero, type ShowroomSlide } from "@/components/showrooms/showroom-hero";
import { PageHeader } from "@/components/layout";
import { TrustStrip } from "@/components/layout/trust-strip";
import { ListingFilterSidebar } from "@/components/listings/listing-filter-sidebar";
import { ListingFilterDrawer } from "@/components/listings/listing-filter-drawer";
import { ListingGridHeader } from "@/components/listings/listing-grid-header";
import { MzansiMarketGrid } from "./grid";
import { MarketplaceUrlFilterSync } from "./url-filter-sync";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";

export const metadata: Metadata = {
  title: "Mzansi Market",
  description:
    "Browse verified classified ads for property, cars, electronics and more across South Africa.",
  alternates: {
    canonical: `${BASE_URL}/mzansi-market`,
  },
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
    .not("title", "ilike", "%seed%")
    .not("title", "ilike", "%[seed]%")
    .not("title", "ilike", "%demo%")
    .not("title", "ilike", "%sample%")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10);

  const slides: ShowroomSlide[] = (listings ?? [])
    .filter((listing) => !isPlaceholderMarketplaceContent(listing.title, listing.description))
    .slice(0, 5)
    .map((l) => ({
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
            : "/images/fallbacks/hero-listing.svg"
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
      <Suspense fallback={null}>
        <MarketplaceUrlFilterSync />
      </Suspense>

      {/* ── Dynamic Showroom Hero ──────────────────────────────────── */}
      <ShowroomHero
        slides={slides}
        fallbackTitle="Mzansi Market Showroom"
        fallbackDescription="Browse classified ads from identity-verified members."
      />

      <TrustStrip variant="green" />

      {/* ── Main Content ─────────────────────────────────── */}
      <div className="container-page py-6 space-y-4">
        <PageHeader
          title="Browse Listings"
          description="Verified classifieds from South African sellers, with filters for price, condition, and location."
          breadcrumbs={[{ label: "Mzansi Market" }]}
        >
          <Button asChild size="sm" className="gap-1">
            <Link href="/post/create">
              Post an ad
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </PageHeader>

        {/* Two-column layout */}
        <div className="flex gap-6">
          {/* Desktop sidebar */}
          <aside className="hidden w-72 shrink-0 lg:block">
            <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1 scrollbar-thin">
              <ListingFilterSidebar />
            </div>
          </aside>

          {/* Main content area */}
          <div className="flex-1 min-w-0">
            {/* Toolbar: location + sort + active chips */}
            <ListingGridHeader />

            {/* Listings grid */}
            <MzansiMarketGrid />
          </div>
        </div>
      </div>

      {/* Mobile filter FAB + drawer */}
      <ListingFilterDrawer />
    </div>
  );
}
