import { createClient } from "@/lib/supabase/server";
import { ShowroomHero, type ShowroomSlide } from "@/components/showrooms/showroom-hero";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { TrustStrip } from "@/components/layout/trust-strip";
import { BusinessCategoryStrip } from "@/components/listings/business-category-strip";
import { MzansiBusinessGrid } from "./grid";
import { MzansiBusinessFilterSync } from "./filter-sync";
import { ListingGridSkeleton } from "@/components/listings/listing-skeleton";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { BusinessDiscoveryBar } from "./discovery-bar";
import { BusinessFilterDrawer } from "@/components/listings/business-filter-drawer";

export const metadata = {
  title: "Mzansi Business",
  description:
    "Discover verified South African businesses — shops, services, mobile providers, and more on VerifyMzansi.",
};

/** Revalidate every 60 seconds (ISR) */
export const revalidate = 60;

export default async function MzansiBusinessPage() {
  const supabase = await createClient();

  // Fetch top businesses for showroom hero
  const { data: topBusinesses } = await supabase
    .from("businesses")
    .select(
      "id, business_name, description, cover_photo, cover_video, video_thumbnail, location_province, location_city, boost_until"
    )
    .eq("status", "live")
    .eq("area", "MZANSI_BUSINESS")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(5);

  const slides: ShowroomSlide[] =
    topBusinesses && topBusinesses.length > 0
      ? topBusinesses.map((b) => ({
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

  // Fetch category counts for auto-hiding empty categories
  const { data: allLive } = await supabase
    .from("businesses")
    .select("category")
    .eq("status", "live")
    .eq("area", "MZANSI_BUSINESS");

  const { data: malls } = await supabase.from("malls").select("id, name").order("name");

  const categoryCounts: Record<string, number> = {};
  for (const b of allLive ?? []) {
    categoryCounts[b.category] = (categoryCounts[b.category] || 0) + 1;
  }

  return (
    <div className="space-y-0">
      <MzansiBusinessFilterSync />

      {/* ── Dynamic Showroom Hero ──────────────────────────────────── */}
      <ShowroomHero
        slides={slides}
        fallbackTitle="Mzansi Business"
        fallbackDescription="Discover verified South African businesses and services."
      />

      <TrustStrip variant="blue" />

      {/* ── Main Content ─────────────────────────────────── */}
      <div className="container-page py-6 space-y-4">
        <PageHeader title="Mzansi Business" breadcrumbs={[{ label: "Mzansi Business" }]} />

        {/* Desktop discovery bar (hidden on mobile — mobile uses the filter drawer) */}
        <div className="hidden lg:block">
          <BusinessDiscoveryBar malls={malls ?? []} />
        </div>

        <BusinessCategoryStrip categoryCounts={categoryCounts} />

        <section className="space-y-6">
          <Suspense fallback={<ListingGridSkeleton count={6} />}>
            <MzansiBusinessGrid />
          </Suspense>
        </section>
      </div>

      {/* Mobile filter FAB + drawer */}
      <BusinessFilterDrawer malls={malls ?? []} />
    </div>
  );
}
