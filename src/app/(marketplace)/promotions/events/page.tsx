import { createAdminClient } from "@/lib/supabase/admin";
import { Calendar, Clock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PromotionCard } from "@/components/listings/promotion-card";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import type { SellerVerificationStatus } from "@/types/enums";

export const metadata = {
  title: "Events",
  description:
    "Discover upcoming events, gatherings, and happenings from verified businesses and sellers across South Africa.",
};

export const revalidate = 60;

export default async function EventsPage() {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Fetch event promotions — prioritise upcoming (end_date in the future), boosted first
  const { data: events } = await admin
    .from("promotions")
    .select(
      `id, seller_id, business_id, title, description, promotion_type, category,
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

  // Gather unique seller IDs for trust levels
  const sellerIds = [...new Set((events ?? []).map((e) => e.seller_id))];
  const { data: sellers } = sellerIds.length
    ? await admin
        .from("seller_profiles")
        .select("user_id, display_name, seller_verification_status")
        .in("user_id", sellerIds)
    : { data: [] };

  const sellerMap = new Map(
    (sellers ?? []).map((s) => [
      s.user_id,
      {
        name: s.display_name,
        trust: computeTrustLevel(
          (s.seller_verification_status ?? "unverified") as SellerVerificationStatus
        ),
      },
    ])
  );

  // Gather unique business IDs for linked business names
  const businessIds = [
    ...new Set((events ?? []).map((e) => e.business_id).filter(Boolean)),
  ] as string[];
  const { data: businesses } = businessIds.length
    ? await admin.from("businesses").select("id, business_name").in("id", businessIds)
    : { data: [] };

  const businessMap = new Map((businesses ?? []).map((b) => [b.id, b.business_name]));

  // Split into upcoming vs past
  const upcoming = (events ?? []).filter((e) => !e.end_date || new Date(e.end_date) >= new Date());
  const past = (events ?? []).filter((e) => e.end_date && new Date(e.end_date) < new Date());

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-7xl">
      <PageHeader
        title="Events"
        description="Upcoming events, gatherings, and happenings from verified businesses across South Africa."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Promotions & Events", href: "/promotions" },
          { label: "Events" },
        ]}
      />

      {/* Upcoming Events */}
      {upcoming.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-purple-500" />
            <h2 className="text-xl font-display font-semibold">Upcoming Events</h2>
            <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
              {upcoming.length}
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {upcoming.map((event) => {
              const seller = sellerMap.get(event.seller_id);
              const businessName = event.business_id
                ? businessMap.get(event.business_id)
                : undefined;
              const nowDate = new Date();
              const isBoosted = event.boost_until ? new Date(event.boost_until) > nowDate : false;
              const isFeatured = event.featured_until
                ? new Date(event.featured_until) > nowDate
                : false;

              return (
                <div key={event.id} className="space-y-1">
                  <PromotionCard
                    id={event.id}
                    title={event.title}
                    price={event.price_cents}
                    negotiable={event.price_negotiable}
                    imageUrl={event.photos?.[0] || event.videos?.[0]}
                    province={event.location_province}
                    city={event.location_city}
                    promotionType="event"
                    createdAt={event.created_at}
                    sellerTrustLevel={seller?.trust}
                    sellerName={seller?.name}
                    viewCount={event.view_count}
                    boosted={isBoosted}
                    featured={isFeatured}
                    endDate={event.end_date}
                  />
                  {/* Event date strip */}
                  {event.start_date && (
                    <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>
                        {new Date(event.start_date).toLocaleDateString("en-ZA", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                        {event.end_date &&
                          event.end_date !== event.start_date &&
                          ` \u2013 ${new Date(event.end_date).toLocaleDateString("en-ZA", {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}`}
                      </span>
                    </div>
                  )}
                  {businessName && (
                    <p className="px-2 text-xs text-brand-blue font-medium truncate">
                      by {businessName}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
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

      {/* Past Events */}
      {past.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xl font-display font-semibold text-muted-foreground">
              Past Events
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 opacity-60">
            {past.map((event) => {
              const seller = sellerMap.get(event.seller_id);
              return (
                <PromotionCard
                  key={event.id}
                  id={event.id}
                  title={event.title}
                  price={event.price_cents}
                  imageUrl={event.photos?.[0] || event.videos?.[0]}
                  province={event.location_province}
                  city={event.location_city}
                  promotionType="event"
                  createdAt={event.created_at}
                  sellerTrustLevel={seller?.trust}
                  sellerName={seller?.name}
                  endDate={event.end_date}
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
