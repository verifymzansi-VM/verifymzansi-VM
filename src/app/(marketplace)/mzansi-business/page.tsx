import { createClient } from "@/lib/supabase/server";
import { type ShowroomSlide } from "@/components/showrooms/showroom-hero";
import { ShowroomWithSideCards } from "@/components/showrooms/showroom-with-side-cards";
import { type SideCardItem } from "@/components/showrooms/showroom-side-card";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { PageHeader } from "@/components/layout";
import { TrustStrip } from "@/components/layout/trust-strip";
import { MzansiBusinessGrid } from "./grid";
import { MzansiBusinessFilterSync } from "./filter-sync";
import { ListingGridSkeleton } from "@/components/listings/listing-skeleton";
import { getOwnerColumn, withOwnerColumn } from "@/lib/account/compat";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { BusinessDiscoveryBar } from "./discovery-bar";
import { BusinessFilterDrawer } from "@/components/listings/business-filter-drawer";
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

export const metadata = {
  title: "Mzansi Business",
  description:
    "Build trusted business visibility and discover verified South African brands, shops, and services on VerifyMzansi.",
  alternates: {
    canonical: "/mzansi-business",
  },
};

/** Revalidate every 60 seconds (ISR) */
export const revalidate = 60;

type PromotionSideCardRow = {
  id: string;
  title?: string | null;
  photos?: string[] | null;
  owner_id?: string | null;
  seller_id?: string | null;
};

export default async function MzansiBusinessPage() {
  const cookieStore = await cookies();
  const hideFixtures = shouldHidePlaywrightFixtures(
    cookieStore.get(PLAYWRIGHT_HIDE_FIXTURES_COOKIE)?.value
  );
  const supabase = await createClient();
  const promotionOwnerColumn = await getOwnerColumn(supabase, "promotions");
  const now = new Date().toISOString();

  // Fetch top businesses for showroom hero
  const { data: topBusinesses } = await supabase
    .from("businesses")
    .select("*")
    .eq("status", "live")
    .eq("area", "MZANSI_BUSINESS")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  const visibleTopBusinesses = (topBusinesses ?? [])
    .filter((business) => !shouldHidePlaywrightFixtureRowWhenEnabled(business, hideFixtures))
    .filter(
      (business) => !isPlaceholderMarketplaceContent(business.business_name, business.description)
    )
    .slice(0, 5);

  const slides: ShowroomSlide[] =
    visibleTopBusinesses.length > 0
      ? visibleTopBusinesses.map((b) => ({
          type: "business",
          id: b.id,
          title: b.business_name,
          description: b.description || "Verified South African business.",
          location: b.location_city || b.location_province || "South Africa",
          mediaUrl: normalizeMediaUrl(
            b.cover_video || b.cover_photo || "/images/fallbacks/hero-business.svg"
          ),
          posterUrl: b.video_thumbnail
            ? normalizeMediaUrl(b.video_thumbnail)
            : b.cover_photo
              ? normalizeMediaUrl(b.cover_photo)
              : undefined,
          logoUrl: b.logo_url ? normalizeMediaUrl(b.logo_url) : undefined,
        }))
      : [
          {
            id: "mzansi-business-empty",
            type: "business",
            title: "Mzansi Business",
            description: "Discover verified South African businesses and services.",
            location: "South Africa",
            mediaUrl: "/images/fallbacks/hero-shop.svg",
            hrefOverride: "/post/create-business",
            ctaLabelOverride: "List Your Business",
            badgeLabelOverride: "Mzansi Business",
          },
        ];

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
      <Suspense fallback={<div className="h-10" />}>
        <MzansiBusinessFilterSync />
      </Suspense>

      {/* ── Dynamic Showroom Hero with side ad cards ─────────────── */}
      <ShowroomWithSideCards
        slides={slides}
        fallbackTitle="Mzansi Business"
        fallbackDescription="Discover verified South African businesses and services."
        sideCardItems={sideCardItems}
      />

      <TrustStrip variant="blue" />

      {/* ── Main Content ─────────────────────────────────── */}
      <div className="container-page py-4 sm:py-6 space-y-4">
        <PageHeader
          title="Mzansi Business"
          description="Browse verified South African businesses, build visibility for your brand, and help customers discover trusted services."
          breadcrumbs={[{ label: "Mzansi Business" }]}
          className="hidden lg:flex"
        >
          <Button asChild size="sm" className="gap-2">
            <Link href="/post/create-business">
              List Your Business
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </PageHeader>

        {/* Compact mobile header */}
        <div className="flex items-center justify-between lg:hidden">
          <h1 className="font-display text-lg font-bold tracking-tight">Mzansi Business</h1>
          <Button asChild size="sm" className="gap-1">
            <Link href="/post/create-business">
              List
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        {/* Mobile filter drawer (FAB visible < lg only) */}
        <BusinessFilterDrawer />

        <div className="flex gap-6">
          <aside className="hidden w-72 shrink-0 lg:block">
            <div className="sticky top-24">
              <BusinessDiscoveryBar />
            </div>
          </aside>

          <section className="min-w-0 flex-1 space-y-6">
            <Suspense fallback={<ListingGridSkeleton count={6} />}>
              <MzansiBusinessGrid />
            </Suspense>
          </section>
        </div>
      </div>
    </div>
  );
}
