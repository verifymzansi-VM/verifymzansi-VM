import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MarketPreviewCard } from "./market-preview-card";
import { AutoScrollRail } from "./auto-scroll-rail";
import { SA_PROVINCES } from "@/lib/constants/sa-provinces";
import { createLogger } from "@/lib/utils/logger";
import { isPlaceholderMarketplaceContent } from "./placeholder-content-filter";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "./playwright-fixture-filter";
import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";

const log = createLogger("HomeMzansiMarketShowcase");

function provinceCode(name: string): string {
  return SA_PROVINCES.find((p) => p.name.toLowerCase() === name?.toLowerCase())?.code ?? name;
}

export async function HomeMzansiMarketShowcase() {
  const cookieStore = await cookies();
  const hideFixtures = shouldHidePlaywrightFixtures(
    cookieStore.get(PLAYWRIGHT_HIDE_FIXTURES_COOKIE)?.value
  );
  const supabase = await createClient();
  const { data: listings, error } = await supabase
    .from("listings")
    .select("*")
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
    .filter((listing) => !shouldHidePlaywrightFixtureRowWhenEnabled(listing, hideFixtures))
    .filter((listing) => !isPlaceholderMarketplaceContent(listing.title, listing.description))
    .slice(0, 8);
  if (items.length === 0) return null;

  return (
    <section className="py-4 sm:py-6 bg-brand-green-50/30 dark:bg-brand-green-950/20">
      <div className="container-page space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-green-700/80 dark:text-brand-green-300/80">
              Step 1
            </p>
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-brand-green-900 dark:text-brand-green-100">
              Start with Mzansi Market
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-2xl">
              Browse the latest deals from verified sellers with one standout card at a time on
              mobile.
            </p>
          </div>
          <Link
            href="/mzansi-market"
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-brand-green/20 bg-white/80 px-4 py-2 text-sm font-semibold text-brand-green shadow-sm transition-colors hover:border-brand-green/35 hover:text-brand-green/80 dark:bg-warm-950/40"
          >
            <span className="inline-flex items-center gap-1.5">
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
                className="min-w-[84vw] max-w-[84vw] sm:min-w-[320px] sm:max-w-[320px] lg:min-w-[264px] lg:max-w-[264px]"
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
                  logoUrl={l.logo_url}
                />
              </div>
            );
          })}
        </AutoScrollRail>
      </div>
    </section>
  );
}
