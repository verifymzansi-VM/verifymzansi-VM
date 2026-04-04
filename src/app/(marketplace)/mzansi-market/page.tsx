import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { type ShowroomSlide } from "@/components/showrooms/showroom-hero";
import { ShowroomWithSideCards } from "@/components/showrooms/showroom-with-side-cards";
import { type SideCardItem } from "@/components/showrooms/showroom-side-card";
import { PageHeader } from "@/components/layout";
import { TrustStrip } from "@/components/layout/trust-strip";
import { ListingFilterSidebar } from "@/components/listings/listing-filter-sidebar";
import { ListingFilterDrawer } from "@/components/listings/listing-filter-drawer";
import { ListingGridHeader } from "@/components/listings/listing-grid-header";
import { MzansiMarketGrid } from "./grid";
import { MarketplaceUrlFilterSync } from "./url-filter-sync";
import { getOwnerColumn, withOwnerColumn } from "@/lib/account/compat";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "@/components/home/playwright-fixture-filter";
import { BRANDED_SIDE_CARD_FALLBACKS } from "@/components/showrooms/side-card-fallbacks";
import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";

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

type PromotionSideCardRow = {
  id: string;
  title?: string | null;
  photos?: string[] | null;
  owner_id?: string | null;
  seller_id?: string | null;
};

export default async function MzansiMarketPage() {
  const cookieStore = await cookies();
  const hideFixtures = shouldHidePlaywrightFixtures(
    cookieStore.get(PLAYWRIGHT_HIDE_FIXTURES_COOKIE)?.value
  );
  const supabase = await createClient();
  const promotionOwnerColumn = await getOwnerColumn(supabase, "promotions");
  const now = new Date().toISOString();

  const { data: listings } = await supabase
    .from("listings")
    .select("*")
    .eq("status", "live")
    .eq("area", "MZANSI_MARKET")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10);

  const slides: ShowroomSlide[] = (listings ?? [])
    .filter((listing) => !shouldHidePlaywrightFixtureRowWhenEnabled(listing, hideFixtures))
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
      logoUrl: l.logo_url ? normalizeMediaUrl(l.logo_url) : undefined,
      price: l.price_cents ? l.price_cents / 100 : null,
      promotions: [],
    }));

  // Fetch live promotions & events for desktop side cards
  const { data: sideCardPromos } = await supabase
    .from("promotions")
    .select(withOwnerColumn("id, title, photos, owner_id", promotionOwnerColumn))
    .eq("status", "live")
    .or(`end_date.is.null,end_date.gte.${now}`)
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  const sideCardItems: SideCardItem[] = (
    (sideCardPromos ?? []) as unknown as PromotionSideCardRow[]
  )
    .filter((promotion) => !shouldHidePlaywrightFixtureRowWhenEnabled(promotion, hideFixtures))
    .filter((promotion) => !isPlaceholderMarketplaceContent(promotion.title))
    .filter((p) => p.photos && p.photos.length > 0)
    .map((p) => ({ id: p.id, imageUrl: normalizeMediaUrl(p.photos![0]) }));

  // Last resort: branded promotional banners when no promotions have photos
  if (sideCardItems.length === 0) {
    sideCardItems.push(...BRANDED_SIDE_CARD_FALLBACKS);
  }

  return (
    <div className="space-y-0">
      <Suspense fallback={null}>
        <MarketplaceUrlFilterSync />
      </Suspense>

      {/* ── Dynamic Showroom Hero with side ad cards ─────────────── */}
      <ShowroomWithSideCards
        slides={slides}
        fallbackTitle="Mzansi Market Showroom"
        fallbackDescription="Browse classified ads from identity-verified members."
        sideCardItems={sideCardItems}
      />

      <TrustStrip variant="green" />

      {/* ── Main Content ─────────────────────────────────── */}
      <div className="container-page py-8 space-y-6">
        <PageHeader
          title="Browse Listings"
          description="Verified classifieds from South African sellers, with filters for price, condition, and location."
          breadcrumbs={[{ label: "Mzansi Market" }]}
          className="hidden lg:flex"
          centered
        >
          <Button asChild size="sm" className="gap-1">
            <Link href="/post/create-listing">
              Create a listing
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </PageHeader>

        {/* Compact mobile header */}
        <div className="flex items-center justify-between lg:hidden">
          <h1 className="font-display text-lg font-bold tracking-tight">Browse Listings</h1>
          <Button asChild size="sm" className="gap-1">
            <Link href="/post/create-listing">
              Post
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        {/* Mobile filter drawer (FAB visible < lg only) */}
        <ListingFilterDrawer />

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
    </div>
  );
}
