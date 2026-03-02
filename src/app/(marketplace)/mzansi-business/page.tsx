import { createClient } from "@/lib/supabase/server";
import { ShowroomHero, type ShowroomSlide } from "@/components/showrooms/showroom-hero";
import { ShieldCheck, BadgeCheck, Search } from "lucide-react";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { BusinessCategoryStrip } from "@/components/listings/business-category-strip";
import { MzansiBusinessGrid } from "./grid";
import { ListingGridSkeleton } from "@/components/listings/listing-skeleton";
import { normalizeMediaUrl } from "@/lib/utils/media-url";

export const metadata = {
  title: "Mzansi Business — Business Directory | VerifyMzansi",
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
      "id, business_name, description, cover_photo, cover_video, location_province, location_city, boost_until"
    )
    .eq("status", "live")
    .eq("area", "MZANSI_BUSINESS")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(5);

  const slides: ShowroomSlide[] = (topBusinesses ?? []).map((b) => ({
    type: "storefront",
    id: b.id,
    title: b.business_name,
    description: b.description || "Verified South African business.",
    location: b.location_city || b.location_province || "South Africa",
    mediaUrl: normalizeMediaUrl(
      b.cover_video ||
        b.cover_photo ||
        "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=1600&q=80"
    ),
  }));

  // Fetch category counts for auto-hiding empty categories
  const { data: allLive } = await supabase
    .from("businesses")
    .select("category")
    .eq("status", "live")
    .eq("area", "MZANSI_BUSINESS");

  const categoryCounts: Record<string, number> = {};
  for (const b of allLive ?? []) {
    categoryCounts[b.category] = (categoryCounts[b.category] || 0) + 1;
  }

  return (
    <div className="space-y-0">
      {/* ── Dynamic Showroom Hero ──────────────────────────────────── */}
      <ShowroomHero
        slides={slides}
        fallbackTitle="Mzansi Business"
        fallbackDescription="Discover verified South African businesses — shops, services, mobile providers, and more."
      />

      {/* ── Trust Strip ──────────────────────────────────── */}
      <section className="border-b bg-blue-50/50 dark:bg-blue-950/30">
        <div className="container-page py-3">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs sm:text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-brand-blue" />
              Identity-verified sellers
            </span>
            <span className="hidden sm:inline text-border">|</span>
            <span className="flex items-center gap-1.5">
              <BadgeCheck className="h-4 w-4 text-brand-blue" />
              Trust-scored profiles
            </span>
            <span className="hidden sm:inline text-border">|</span>
            <span className="flex items-center gap-1.5">
              <Search className="h-4 w-4 text-brand-blue" />
              Moderated listings
            </span>
          </div>
        </div>
      </section>

      {/* ── Main Content ─────────────────────────────────── */}
      <div className="container-page py-6 space-y-4">
        <PageHeader
          title="Mzansi Business"
          description="Browse verified businesses across South Africa — shops, services, and more."
          breadcrumbs={[{ label: "Mzansi Business" }]}
        />

        <BusinessCategoryStrip categoryCounts={categoryCounts} />

        <section className="space-y-6">
          <Suspense fallback={<ListingGridSkeleton count={6} />}>
            <MzansiBusinessGrid />
          </Suspense>
        </section>
      </div>
    </div>
  );
}
