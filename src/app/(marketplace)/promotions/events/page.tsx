import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { Calendar } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PromotionCard } from "@/components/listings/promotion-card";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import {
  ACCOUNT_PROFILE_TABLE,
  getOwnerColumn,
  normalizeOwnerRecords,
  readAccountVerificationStatus,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { PastEventsAccordion } from "./past-events-accordion";
import Link from "next/link";
import { getOptionalContentViewCountMap } from "@/lib/engagement-server";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";

export const metadata = {
  title: "Events in South Africa",
  description:
    "Find upcoming South African events, markets, shows, community gatherings, and live experiences posted by identity-reviewed hosts, organisers, and businesses.",
};

export const revalidate = 60;
type EventRow = {
  id: string;
  owner_id?: string | null;
  seller_id?: string | null;
  business_id?: string | null;
  title: string | null;
  description?: string | null;
  photos?: string[] | null;
  videos?: string[] | null;
  video_thumbnail?: string | null;
  focal_x?: number | null;
  focal_y?: number | null;
  media_width?: number | null;
  media_height?: number | null;
  price_cents?: number | null;
  price_negotiable?: boolean | null;
  location_province?: string | null;
  location_city?: string | null;
  start_date: string | null;
  end_date?: string | null;
  boost_until?: string | null;
  featured_until?: string | null;
  view_count?: number | null;
  created_at: string;
};

function groupByMonth(
  events: Array<{
    id: string;
    start_date: string | null;
    created_at: string;
    [key: string]: unknown;
  }>
) {
  const groups: Record<string, typeof events> = {};
  for (const event of events) {
    const dateStr = event.start_date || event.created_at;
    const date = new Date(dateStr);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const label = date.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
    if (!groups[`${key}|${label}`]) groups[`${key}|${label}`] = [];
    groups[`${key}|${label}`].push(event);
  }
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({
      label: key.split("|")[1],
      events: items,
    }));
}

function isPlaceholderEvent(event: { title: string | null; description?: string | null }) {
  return isPlaceholderMarketplaceContent(event.title, event.description);
}

export default async function EventsPage() {
  const admin = await createClient();
  const engagementAdmin = tryCreateAdminClient();
  const promotionOwnerColumn = await getOwnerColumn(admin, "promotions");
  const now = new Date().toISOString();

  // Fetch event promotions — prioritise upcoming (end_date in the future), boosted first
  const { data: events } = await applyVisibleExpiryFilter(
    admin
      .from("promotions")
      .select(
        withOwnerColumn(
          `id, owner_id, business_id, title, description, promotion_type, category,
       photos, videos, video_thumbnail, focal_x, focal_y, media_width, media_height, logo_url, price_cents, price_negotiable, location_province, location_city,
       start_date, end_date, boost_until, featured_until, view_count, created_at`,
          promotionOwnerColumn
        )
      )
      .eq("status", "live")
      .eq("promotion_type", "event")
      .or(`end_date.is.null,end_date.gte.${now}`),
    now
  )
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("start_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(48);

  // Also fetch past events
  const { data: pastEvents } = await applyVisibleExpiryFilter(
    admin
      .from("promotions")
      .select(
        withOwnerColumn(
          `id, owner_id, business_id, title, promotion_type,
       photos, videos, video_thumbnail, focal_x, focal_y, media_width, media_height, logo_url, price_cents, price_negotiable, location_province, location_city,
       start_date, end_date, view_count, created_at`,
          promotionOwnerColumn
        )
      )
      .eq("status", "live")
      .eq("promotion_type", "event")
      .lt("end_date", now),
    now
  )
    .order("end_date", { ascending: false })
    .limit(24);

  // Gather unique account IDs for trust levels
  const upcoming = normalizeOwnerRecords((events ?? []) as unknown as EventRow[]).filter(
    (event) => !isPlaceholderEvent(event)
  );
  const past = normalizeOwnerRecords((pastEvents ?? []) as unknown as EventRow[]).filter(
    (event) => !isPlaceholderEvent(event)
  );
  const allEventIds = [...upcoming, ...past].map((event) => event.id);
  const allViewSummary = await getOptionalContentViewCountMap(
    engagementAdmin,
    "promotion",
    allEventIds
  );
  const allEvents = [...upcoming, ...past];
  const accountIds = [...new Set(allEvents.map((event) => readOwnerId(event)).filter(Boolean))];
  const { data: accountProfiles } = accountIds.length
    ? await admin
        .from(ACCOUNT_PROFILE_TABLE)
        .select("user_id, display_name, account_verification_status")
        .in("user_id", accountIds)
    : { data: [] };

  const accountProfileMap = new Map(
    (accountProfiles ?? []).map((accountProfile) => [
      accountProfile.user_id,
      {
        name: accountProfile.display_name,
        trust: computeTrustLevel(readAccountVerificationStatus(accountProfile)),
      },
    ])
  );

  // Gather unique business IDs for linked business names
  const businessIds = [...new Set(allEvents.map((e) => e.business_id).filter(Boolean))] as string[];
  const { data: businesses } = businessIds.length
    ? await applyVisibleExpiryFilter(
        admin.from("businesses").select("id, business_name, logo_url").eq("status", "live"),
        now
      ).in("id", businessIds)
    : { data: [] };

  const businessMap = new Map((businesses ?? []).map((b) => [b.id, b.business_name]));
  const businessLogoMap = new Map((businesses ?? []).map((b) => [b.id, b.logo_url]));

  // Group upcoming events by month
  const monthGroups = groupByMonth(upcoming);

  return (
    <div className="container-page py-8 space-y-6">
      <PageHeader
        title="Events in South Africa"
        description="Browse upcoming events, markets, shows, community gatherings, and live experiences from South African hosts, organisers, and businesses."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Tourism & Events", href: "/tourism-events" },
          { label: "Events" },
        ]}
      >
        <Button asChild size="sm" className="h-11 gap-1">
          <Link href="/post/create-tourism?type=event">Create Event</Link>
        </Button>
      </PageHeader>

      {/* Upcoming Events — grouped by month */}
      {upcoming.length > 0 ? (
        <>
          {monthGroups.map((group) => (
            <section key={group.label} className="space-y-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-purple-500" />
                <h2 className="text-xl font-display font-semibold">{group.label}</h2>
                <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                  {group.events.length}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5 xl:gap-6">
                {group.events.map((event, index) => {
                  const accountProfile = accountProfileMap.get(readOwnerId(event) as string);
                  const businessName = event.business_id
                    ? businessMap.get(event.business_id as string)
                    : undefined;
                  const businessLogo = event.business_id
                    ? businessLogoMap.get(event.business_id as string)
                    : undefined;
                  const nowDate = new Date();
                  const isBoosted = event.boost_until
                    ? new Date(event.boost_until as string) > nowDate
                    : false;
                  const isFeatured = event.featured_until
                    ? new Date(event.featured_until as string) > nowDate
                    : false;

                  return (
                    <div
                      key={event.id}
                      className={`content-auto animate-in fade-in fill-mode-both [animation-duration:400ms] sm:slide-in-from-bottom-2 [animation-delay:${Math.min(index * 50, 400)}ms]`}
                    >
                      <PromotionCard
                        id={event.id}
                        title={event.title as string}
                        price={event.price_cents as number | null}
                        negotiable={event.price_negotiable as boolean}
                        imageUrl={
                          (event.videos as string[] | null)?.[0] ||
                          (event.video_thumbnail as string | null) ||
                          (event.photos as string[] | null)?.[0]
                        }
                        posterUrl={
                          (event.video_thumbnail as string | null) ||
                          (event.photos as string[] | null)?.[0] ||
                          undefined
                        }
                        province={event.location_province as string}
                        city={event.location_city as string}
                        promotionType="event"
                        createdAt={event.created_at}
                        ownerTrustLevel={accountProfile?.trust}
                        ownerName={accountProfile?.name}
                        viewCount={
                          allViewSummary.ok
                            ? (allViewSummary.data.get(event.id) ?? undefined)
                            : undefined
                        }
                        boosted={isBoosted}
                        featured={isFeatured}
                        startDate={event.start_date as string | null}
                        endDate={event.end_date as string | null}
                        businessName={businessName}
                        logoUrl={
                          ((event as Record<string, unknown>).logo_url as string | undefined) ||
                          businessLogo
                        }
                        focalX={(event.focal_x as number | null | undefined) ?? null}
                        focalY={(event.focal_y as number | null | undefined) ?? null}
                        mediaWidth={(event.media_width as number | null | undefined) ?? null}
                        mediaHeight={(event.media_height as number | null | undefined) ?? null}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      ) : (
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <Calendar className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="font-display text-lg font-semibold">No upcoming events</h3>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Check back soon for South African events from local hosts, organisers, and businesses.
              Past events may appear below.
            </p>
            <Button asChild size="sm" className="mx-auto h-11 w-fit gap-1">
              <Link href="/post/create-tourism?type=event">Create Event</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Past Events — collapsed accordion */}
      {past.length > 0 && (
        <PastEventsAccordion
          events={past.map((event) => {
            const accountProfile = accountProfileMap.get(readOwnerId(event) as string);
            const videos = event.videos as string[] | null;
            const photos = event.photos as string[] | null;
            return {
              id: event.id,
              title: event.title ?? "Untitled event",
              price: event.price_cents ?? null,
              negotiable: event.price_negotiable as boolean,
              imageUrl: videos?.[0] || (event.video_thumbnail as string | null) || photos?.[0],
              posterUrl: videos?.[0]
                ? (event.video_thumbnail as string | null) || photos?.[0] || undefined
                : undefined,
              province: event.location_province ?? "",
              city: event.location_city ?? "",
              createdAt: event.created_at,
              viewCount: allViewSummary.ok
                ? (allViewSummary.data.get(event.id) ?? undefined)
                : undefined,
              ownerTrustLevel: accountProfile?.trust,
              ownerName: accountProfile?.name,
              startDate: event.start_date,
              endDate: event.end_date,
              focalX: (event.focal_x as number | null | undefined) ?? null,
              focalY: (event.focal_y as number | null | undefined) ?? null,
              mediaWidth: (event.media_width as number | null | undefined) ?? null,
              mediaHeight: (event.media_height as number | null | undefined) ?? null,
              logoUrl: event.business_id
                ? (businessLogoMap.get(event.business_id as string) ?? null)
                : null,
            };
          })}
        />
      )}
    </div>
  );
}
