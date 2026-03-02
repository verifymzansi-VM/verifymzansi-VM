import { createClient } from "@/lib/supabase/server";
import { ShowroomHero, type ShowroomSlide } from "@/components/showrooms/showroom-hero";
import { ShieldCheck, BadgeCheck, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { BusinessAdCategoryStrip } from "@/components/listings/business-ad-category-strip";
import { BusinessDirectorySidebar } from "@/components/listings/business-directory-sidebar";
import { BusinessAdHeader } from "@/components/listings/business-ad-header";
import { BusinessAdsGrid } from "./grid";
import { normalizeMediaUrl } from "@/lib/utils/media-url";

export const metadata = {
  title: "Business Ads — Professional Profiles | VerifyMzansi",
  description:
    "Discover verified South African businesses — service providers, consultants and more.",
};

/** Revalidate business ads every 60 seconds (ISR) */
export const revalidate = 60;

export default async function BusinessAdsPage() {
  const supabase = await createClient();

  const { data: businesses } = await supabase
    .from("business_profiles")
    .select("id, business_name, about, cover_photo, cover_video, service_areas, boost_until")
    .eq("status", "live")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(5);

  const slides: ShowroomSlide[] = (businesses ?? []).map((b) => {
    const areas =
      b.service_areas && typeof b.service_areas === "object"
        ? (b.service_areas as Record<string, unknown>)
        : null;
    const city = areas && typeof areas.city === "string" ? areas.city : null;
    const province = areas && typeof areas.province === "string" ? areas.province : null;
    const location = city && province ? `${city}, ${province}` : city || province || "South Africa";

    return {
      type: "business",
      id: b.id,
      title: b.business_name,
      description: b.about || "Trusted local service provider.",
      location,
      mediaUrl: normalizeMediaUrl(
        b.cover_video ||
          b.cover_photo ||
          "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=1600&q=80"
      ),
    };
  });

  return (
    <div className="space-y-0">
      {/* ── Dynamic Showroom Hero ──────────────────────────────────── */}
      <ShowroomHero
        slides={slides}
        fallbackTitle="Business Ads Showroom"
        fallbackDescription="An exclusive showroom for professional services. Discover trusted South African businesses and verified service providers."
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
          title="Professional Directory"
          description="Discover verified South African businesses, service providers, and consultants."
          breadcrumbs={[{ label: "Business Ads" }]}
        />

        <BusinessAdCategoryStrip />

        {/* Two-column layout */}
        <div className="flex gap-6">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-72 shrink-0">
            <BusinessDirectorySidebar />
          </aside>

          {/* Main content area */}
          <div className="flex-1 min-w-0">
            <BusinessAdHeader />

            <BusinessAdsGrid />
          </div>
        </div>
      </div>
    </div>
  );
}
