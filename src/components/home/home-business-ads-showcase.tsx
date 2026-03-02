import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AreaPreviewCard } from "./area-preview-card";

export async function HomeBusinessAdsShowcase() {
  const supabase = await createClient();
  const { data: businesses } = await supabase
    .from("business_profiles")
    .select("id, business_name, cover_photo, about, service_areas, boost_until")
    .eq("status", "live")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(8);

  const items = businesses ?? [];
  if (items.length === 0) return null;

  return (
    <section className="py-6 sm:py-12 bg-brand-blue-50/30 dark:bg-brand-blue-950/20">
      <div className="container-page space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-brand-blue-900 dark:text-brand-blue-100">
              Top Verified Businesses
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-2xl">
              Discover trusted local services and companies ready to help you.
            </p>
          </div>
          <Link href="/business-ads" className="shrink-0">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue hover:text-brand-blue/80 transition-colors">
              Explore All Businesses
              <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {items.map((b) => {
            const areas = b.service_areas as Record<string, unknown> | null;
            const city =
              (areas && typeof areas.city === "string" ? areas.city : null) ?? "South Africa";
            const province =
              (areas && typeof areas.province === "string" ? areas.province : null) ?? "ZA";
            return (
              <AreaPreviewCard
                key={b.id}
                href={`/business-ads/${b.id}`}
                imageUrl={b.cover_photo}
                title={b.business_name}
                description={b.about}
                city={city}
                provinceCode={province}
                accentColor="blue"
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
