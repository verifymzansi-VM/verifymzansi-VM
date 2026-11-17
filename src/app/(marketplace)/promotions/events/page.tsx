import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import { readRestoredCollection } from "@/lib/foundation/marketplace-read";
import { Calendar } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PromotionCard } from "@/components/listings/promotion-card";
import { DisableMobileAutoplay } from "@/contexts/autoplay-policy-context";
import { normalizeOwnerRecords } from "@/lib/account/compat";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { PastEventsAccordion } from "./past-events-accordion";
import Link from "next/link";

export const metadata = {
  title: "Events in South Africa",
  description:
    "Find upcoming South African events, markets, shows, community gatherings, and live experiences posted by ID-reviewed hosts, organisers, and businesses.",
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
  // Fetch event promotions — prioritise upcoming (end_date in the future), boosted first
  const events = (
    await readRestoredCollection(
      foundationServerPublicApi(),
      "promotions",
      new URLSearchParams({ limit: "48", event_order: "start_asc" })
    )
  ).rows.sort((a, b) => Date.parse(a.start_date!) - Date.parse(b.start_date!));

  // Also fetch past events
  const pastEvents = (
    await readRestoredCollection(
      foundationServerPublicApi(),
      "promotions",
      new URLSearchParams({ limit: "24", event_state: "ended", event_order: "end_desc" })
    )
  ).rows.sort((a, b) => Date.parse(b.end_date!) - Date.parse(a.end_date!));

  const upcoming = normalizeOwnerRecords(events as unknown as EventRow[]).filter(
    (event) => !isPlaceholderEvent(event)
  );
  const past = normalizeOwnerRecords(pastEvents as unknown as EventRow[]).filter(
    (event) => !isPlaceholderEvent(event)
  );

  // Group upcoming events by month
  const monthGroups = groupByMonth(upcoming);

  return (
    <DisableMobileAutoplay>
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
            <Link href="/post/create-tourism?type=event">List an event</Link>
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
                          boosted={isBoosted}
                          featured={isFeatured}
                          startDate={event.start_date as string | null}
                          endDate={event.end_date as string | null}
                          logoUrl={
                            ((event as Record<string, unknown>).logo_url as string | undefined) ||
                            undefined
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
                Check back soon for South African events from local hosts, organisers, and
                businesses. Past events may appear below.
              </p>
              <Button asChild size="sm" className="mx-auto h-11 w-fit gap-1">
                <Link href="/post/create-tourism?type=event">List an event</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Past Events — collapsed accordion */}
        {past.length > 0 && (
          <PastEventsAccordion
            events={past.map((event) => {
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
                startDate: event.start_date,
                endDate: event.end_date,
                focalX: (event.focal_x as number | null | undefined) ?? null,
                focalY: (event.focal_y as number | null | undefined) ?? null,
                mediaWidth: (event.media_width as number | null | undefined) ?? null,
                mediaHeight: (event.media_height as number | null | undefined) ?? null,
                logoUrl: null,
              };
            })}
          />
        )}
      </div>
    </DisableMobileAutoplay>
  );
}
