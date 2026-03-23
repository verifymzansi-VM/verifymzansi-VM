import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MarketPreviewCard } from "./market-preview-card";
import { AutoScrollRail } from "./auto-scroll-rail";
import { SA_PROVINCES } from "@/lib/constants/sa-provinces";
import { createLogger } from "@/lib/utils/logger";
import { isPlaceholderMarketplaceContent } from "./placeholder-content-filter";

const log = createLogger("HomeMzansiMarketShowcase");

function provinceCode(name: string): string {
  return SA_PROVINCES.find((p) => p.name.toLowerCase() === name?.toLowerCase())?.code ?? name;
}

export async function HomeMzansiMarketShowcase() {
  const supabase = await createClient();
  const { data: listings, error } = await supabase
    .from("listings")
    .select(
      "id, title, description, price_cents, photos, videos, video_thumbnail, location_province, location_city, boost_until"
    )
    .eq("status", "live")
    .eq("area", "MZANSI_MARKET")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(16);

  if (error) {
    log.warn("Failed to load home Mzansi Market showcase", { error: error.message });
    return null;
  }

  const items = (listings ?? [])
    .filter((listing) => !isPlaceholderMarketplaceContent(listing.title, listing.description))
    .slice(0, 8);
  if (items.length === 0) return null;

  return (
    <section className="py-4 sm:py-6 bg-brand-green-50/30 dark:bg-brand-green-950/20">
      <div className="container-page space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-brand-green-900 dark:text-brand-green-100">
              Latest on Mzansi Market
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-2xl">
              Deals on vehicles, property, electronics & more from verified sellers.
            </p>
          </div>
          <Link href="/mzansi-market" className="shrink-0">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-green hover:text-brand-green/80 transition-colors">
              View All Listings
              <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </div>

        <AutoScrollRail ariaLabel="Latest on Mzansi Market">
          {items.map((l) => {
            const videoUrl = l.videos?.[0];
            const displayUrl = videoUrl || l.photos?.[0];
            const isBoosted = l.boost_until ? new Date(l.boost_until) > new Date() : false;
            const poster = l.video_thumbnail || l.photos?.[0] || undefined;
            return (
              <div
                key={l.id}
                className="min-w-[240px] max-w-[264px] sm:min-w-[264px] sm:max-w-[264px]"
              >
                <MarketPreviewCard
                  href={`/listing/${l.id}`}
                  imageUrl={displayUrl}
                  posterUrl={poster}
                  title={l.title}
                  price={l.price_cents ? l.price_cents / 100 : null}
                  city={l.location_city ?? "South Africa"}
                  provinceCode={provinceCode(l.location_province ?? "ZA")}
                  boosted={isBoosted}
                />
              </div>
            );
          })}
        </AutoScrollRail>
      </div>
    </section>
  );
}
