import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { BusinessPreviewCard } from "./business-preview-card";
import { AutoScrollRail } from "./auto-scroll-rail";
import { HomeShowcaseShell } from "./home-showcase-shell";
import { HomeShowcaseEmptyState } from "./home-showcase-empty-state";
import { SA_PROVINCES } from "@/lib/constants/sa-provinces";
import type { BusinessType } from "@/types/enums";
import { Building2 } from "lucide-react";
import { isPlaceholderMarketplaceContent } from "./placeholder-content-filter";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "./playwright-fixture-filter";
import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";
import { getOptionalContentViewCountMap } from "@/lib/engagement-server";
import { getOptionalCookieStore, readCookieValue } from "@/lib/utils/request-context";

function provinceCode(name: string): string {
  return SA_PROVINCES.find((p) => p.name.toLowerCase() === name?.toLowerCase())?.code ?? name;
}

export async function HomeBusinessShowcase() {
  const cookieStore = await getOptionalCookieStore();
  const hideFixtures = shouldHidePlaywrightFixtures(
    readCookieValue(cookieStore, PLAYWRIGHT_HIDE_FIXTURES_COOKIE)
  );
  const supabase = await createClient();
  const engagementAdmin = tryCreateAdminClient();
  const { data: businesses } = await supabase
    .from("businesses")
    .select("*")
    .eq("status", "live")
    .eq("area", "MZANSI_BUSINESS")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(16);

  const items = (businesses ?? [])
    .filter((business) => !shouldHidePlaywrightFixtureRowWhenEnabled(business, hideFixtures))
    .filter(
      (business) => !isPlaceholderMarketplaceContent(business.business_name, business.description)
    )
    .slice(0, 8);
  if (items.length === 0) {
    return (
      <HomeShowcaseShell
        badge="Mzansi Business"
        title="Mzansi Business"
        description="Business profiles posted by accountable, identity-reviewed representatives."
        href="/mzansi-business"
        ctaLabel="View Representative Profiles"
        tone="blue"
      >
        <HomeShowcaseEmptyState
          title="No representative profiles yet."
          description="The directory is ready for its first identity-reviewed representative profile. Add a business profile and it will appear here."
          ctaHref="/post/create-business"
          ctaLabel="Create First Profile"
          tone="blue"
          icon={<Building2 className="h-7 w-7" />}
        />
      </HomeShowcaseShell>
    );
  }
  const businessIds = items.map((business) => business.id as string);
  const viewCountMap = await getOptionalContentViewCountMap(
    engagementAdmin,
    "business",
    businessIds
  );

  return (
    <HomeShowcaseShell
      badge="Mzansi Business"
      title="Mzansi Business"
      description="Business profiles posted by accountable, identity-reviewed representatives."
      href="/mzansi-business"
      ctaLabel="View Representative Profiles"
      tone="blue"
    >
      <AutoScrollRail ariaLabel="Mzansi Business" showEdgeFades={false} flushEdges>
        {items.map((b) => (
          <div key={b.id} className="h-full w-[272px] sm:w-[296px] lg:w-[260px]">
            <BusinessPreviewCard
              href={`/mzansi-business/${b.id}`}
              imageUrl={b.cover_video || b.video_thumbnail || b.cover_photo}
              posterUrl={b.video_thumbnail || b.cover_photo || undefined}
              logoUrl={b.logo_url}
              title={b.business_name}
              businessType={(b.business_type || "general_store") as BusinessType}
              city={b.location_city ?? "South Africa"}
              provinceCode={provinceCode(b.location_province ?? "ZA")}
              boosted={b.boost_until ? new Date(b.boost_until) > new Date() : false}
              featured={b.featured_until ? new Date(b.featured_until) > new Date() : false}
              viewCount={
                viewCountMap.ok ? (viewCountMap.data.get(b.id as string) ?? undefined) : undefined
              }
              priority={false}
              focalX={b.focal_x as number | null | undefined}
              focalY={b.focal_y as number | null | undefined}
              mediaWidth={b.media_width as number | null | undefined}
              mediaHeight={b.media_height as number | null | undefined}
            />
          </div>
        ))}
      </AutoScrollRail>
    </HomeShowcaseShell>
  );
}
