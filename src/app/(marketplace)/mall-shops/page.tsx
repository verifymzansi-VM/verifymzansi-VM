import { createClient } from "@/lib/supabase/server";
import { ShowroomHero, type ShowroomSlide } from "@/components/showrooms/showroom-hero";
import { ShieldCheck, BadgeCheck, Search } from "lucide-react";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { MallShopCategoryStrip } from "@/components/listings/mall-shop-category-strip";
import { FeaturedShopsCarousel } from "@/components/listings/featured-shops-carousel";
import { MallShopHeader } from "@/components/listings/mall-shop-header";
import { MallShopsGrid } from "./grid";
import { ListingGridSkeleton } from "@/components/listings/listing-skeleton";
import { normalizeMediaUrl } from "@/lib/utils/media-url";

export const metadata = {
  title: "Mall Shops — Storefronts | VerifyMzansi",
  description: "Browse verified Malls with custom branding, posts and promotions on VerifyMzansi.",
};

/** Revalidate mall shops every 60 seconds (ISR) */
export const revalidate = 60;

export default async function MallShopsPage() {
  const supabase = await createClient();

  const { data: malls } = await supabase
    .from("storefronts")
    .select(
      "id, mall_name, description, cover_photo, cover_video, location_province, location_city, boost_until"
    )
    .eq("status", "live")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(5);

  const slides: ShowroomSlide[] = (malls ?? []).map((m) => ({
    type: "storefront",
    id: m.id,
    title: m.mall_name,
    description: m.description || "Premium verified mall shop.",
    location: m.location_city || m.location_province || "South Africa",
    mediaUrl: normalizeMediaUrl(
      m.cover_video ||
        m.cover_photo ||
        "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1600&q=80"
    ),
  }));

  return (
    <div className="space-y-0">
      {/* ── Dynamic Showroom Hero ──────────────────────────────────── */}
      <ShowroomHero
        slides={slides}
        fallbackTitle="Mall Shops Showroom"
        fallbackDescription="An exclusive showroom for mall storefronts. Browse dedicated shops, promotions, and custom branding from verified Malls."
      />

      {/* ── Trust Strip ──────────────────────────────────── */}
      <section className="border-b bg-brand-green-50/50 dark:bg-brand-green-950/30">
        <div className="container-page py-3">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs sm:text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-brand-green" />
              Identity-verified sellers
            </span>
            <span className="hidden sm:inline text-border">|</span>
            <span className="flex items-center gap-1.5">
              <BadgeCheck className="h-4 w-4 text-brand-green" />
              Trust-scored profiles
            </span>
            <span className="hidden sm:inline text-border">|</span>
            <span className="flex items-center gap-1.5">
              <Search className="h-4 w-4 text-brand-green" />
              Moderated listings
            </span>
          </div>
        </div>
      </section>

      {/* ── Main Content ─────────────────────────────────── */}
      <div className="container-page py-6 space-y-4">
        <PageHeader
          title="Featured Malls"
          description="Explore branded storefronts verified by VerifyMzansi."
          breadcrumbs={[{ label: "Mall Shops" }]}
        />

        <MallShopCategoryStrip />

        <div className="flex flex-col gap-6">
          <section>
            <Suspense
              fallback={<div className="h-[300px] w-full animate-pulse bg-muted rounded-xl" />}
            >
              <FeaturedShopsCarousel />
            </Suspense>
          </section>

          <section className="space-y-6">
            <MallShopHeader />

            <Suspense fallback={<ListingGridSkeleton count={6} />}>
              <MallShopsGrid />
            </Suspense>
          </section>
        </div>
      </div>
    </div>
  );
}
