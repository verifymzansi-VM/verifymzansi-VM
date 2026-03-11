import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BusinessPreviewCard } from "./business-preview-card";
import { AutoScrollRail } from "./auto-scroll-rail";
import { SA_PROVINCES } from "@/lib/constants/sa-provinces";
import type { BusinessType } from "@/types/enums";
import { isPlaceholderMarketplaceContent } from "./placeholder-content-filter";

function provinceCode(name: string): string {
  return SA_PROVINCES.find((p) => p.name.toLowerCase() === name?.toLowerCase())?.code ?? name;
}

export async function HomeBusinessShowcase() {
  const supabase = await createClient();
  const { data: businesses } = await supabase
    .from("businesses")
    .select(
      "id, business_name, description, cover_photo, cover_video, video_thumbnail, logo_url, business_type, location_province, location_city, boost_until"
    )
    .eq("status", "live")
    .eq("area", "MZANSI_BUSINESS")
    .not("business_name", "ilike", "%seed%")
    .not("business_name", "ilike", "%[seed]%")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(16);

  const items = (businesses ?? [])
    .filter(
      (business) => !isPlaceholderMarketplaceContent(business.business_name, business.description)
    )
    .slice(0, 8);
  if (items.length === 0) return null;

  return (
    <section className="py-4 sm:py-6 bg-blue-50/30 dark:bg-blue-950/20">
      <div className="container-page space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-blue-900 dark:text-blue-100">
              Mzansi Business
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-2xl">
              Verified SA businesses — shops, services & more.
            </p>
          </div>
          <Link href="/mzansi-business" className="shrink-0">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue hover:text-brand-blue/80 transition-colors">
              Browse All Businesses
              <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </div>

        <AutoScrollRail ariaLabel="Mzansi Business">
          {items.map((b) => (
            <div
              key={b.id}
              className="min-w-[280px] max-w-[320px] sm:min-w-[320px] sm:max-w-[320px]"
            >
              <BusinessPreviewCard
                href={`/mzansi-business/${b.id}`}
                imageUrl={b.cover_video || b.cover_photo}
                posterUrl={b.video_thumbnail || b.cover_photo || undefined}
                logoUrl={b.logo_url}
                title={b.business_name}
                businessType={(b.business_type || "general_store") as BusinessType}
                city={b.location_city ?? "South Africa"}
                provinceCode={provinceCode(b.location_province ?? "ZA")}
              />
            </div>
          ))}
        </AutoScrollRail>
      </div>
    </section>
  );
}
