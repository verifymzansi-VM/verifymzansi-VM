import { createAdminClient } from "@/lib/supabase/admin";
import { Calendar } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PromotionCard } from "@/components/listings/promotion-card";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { ACCOUNT_PROFILE_TABLE, readAccountVerificationStatus } from "@/lib/account/compat";
import { PastEventsAccordion } from "./past-events-accordion";

export const metadata = {
  title: "Events",
  description:
    "Discover upcoming events, gatherings, and happenings from verified businesses and advertisers across South Africa.",
};

export const revalidate = 60;

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

export default async function EventsPage() {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Fetch event promotions — prioritise upcoming (end_date in the future), boosted first
  const { data: events } = await admin
    .from("promotions")
    .select(
      `id, owner_id, business_id, title, description, promotion_type, category,
       photos, videos, price_cents, price_negotiable, location_province, location_city,
       start_date, end_date, boost_until, featured_until, view_count, created_at`
    )
    .eq("status", "live")
    .eq("promotion_type", "event")
    .or(`end_date.is.null,end_date.gte.${now}`)
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("start_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(48);

  // Also fetch past events
  const { data: pastEvents } = await admin
    .from("promotions")
    .select(
      `id, owner_id, business_id, title, promotion_type,
       photos, videos, video_thumbnail, price_cents, price_negotiable, location_province, location_city,
       start_date, end_date, view_count, created_at`
    )
    .eq("status", "live")
    .eq("promotion_type", "event")
    .lt("end_date", now)
    .order("end_date", { ascending: false })
    .limit(24);

  // Gather unique account IDs for trust levels
  const allEvents = [...(events ?? []), ...(pastEvents ?? [])];
  const accountIds = [...new Set(allEvents.map((event) => event.owner_id))];
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
    ? await admin.from("businesses").select("id, business_name").in("id", businessIds)
    : { data: [] };

  const businessMap = new Map((businesses ?? []).map((b) => [b.id, b.business_name]));

  const upcoming = events ?? [];
  const past = pastEvents ?? [];

  // Group upcoming events by month
  const monthGroups = groupByMonth(
    upcoming as Array<{
      id: string;
      start_date: string | null;
      created_at: string;
      [key: string]: unknown;
    }>
  );

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-7xl">
      <PageHeader
        title="Events"
        description="Upcoming events from verified businesses."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Promotions & Events", href: "/promotions" },
          { label: "Events" },
        ]}
      />

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

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {group.events.map((event, index) => {
                  const accountProfile = accountProfileMap.get(event.owner_id as string);
                  const businessName = event.business_id
                    ? businessMap.get(event.business_id as string)
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
                      className={`animate-in fade-in slide-in-from-bottom-2 fill-mode-both [animation-duration:400ms] [animation-delay:${Math.min(index * 50, 400)}ms]`}
                    >
                      <PromotionCard
                        id={event.id}
                        title={event.title as string}
                        price={event.price_cents as number | null}
                        negotiable={event.price_negotiable as boolean}
                        imageUrl={
                          (event.photos as string[] | null)?.[0] ||
                          (event.videos as string[] | null)?.[0]
                        }
                        province={event.location_province as string}
                        city={event.location_city as string}
                        promotionType="event"
                        createdAt={event.created_at}
                        ownerTrustLevel={accountProfile?.trust}
                        ownerName={accountProfile?.name}
                        viewCount={event.view_count as number}
                        boosted={isBoosted}
                        featured={isFeatured}
                        startDate={event.start_date as string | null}
                        endDate={event.end_date as string | null}
                        businessName={businessName}
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
          <CardContent className="p-6 text-center space-y-3">
            <Calendar className="h-8 w-8 text-muted-foreground mx-auto" />
            <h3 className="font-display text-lg font-semibold">No upcoming events</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Check back soon for events from verified businesses!
            </p>
          </CardContent>
        </Card>
      )}

      {/* Past Events — collapsed accordion */}
      {past.length > 0 && (
        <PastEventsAccordion
          events={past.map((event) => {
            const accountProfile = accountProfileMap.get(event.owner_id);
            const videos = event.videos as string[] | null;
            const photos = event.photos as string[] | null;
            return {
              id: event.id,
              title: event.title,
              price: event.price_cents,
              negotiable: event.price_negotiable as boolean,
              imageUrl: photos?.[0] || videos?.[0],
              posterUrl: videos?.[0]
                ? (event.video_thumbnail as string | null) || photos?.[0] || undefined
                : undefined,
              province: event.location_province,
              city: event.location_city,
              createdAt: event.created_at,
              ownerTrustLevel: accountProfile?.trust,
              ownerName: accountProfile?.name,
              startDate: event.start_date,
              endDate: event.end_date,
            };
          })}
        />
      )}
    </div>
  );
}
