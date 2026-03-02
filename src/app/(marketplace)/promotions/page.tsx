import { createAdminClient } from "@/lib/supabase/admin";
import { Megaphone, Flame, Star, Zap, Store, Briefcase, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListingCard } from "@/components/listings/listing-card";
import Link from "next/link";

/* ---------- row shapes from Supabase queries ---------- */
interface PromotedListing {
  id: string;
  title: string;
  price_cents: number;
  photos: string[] | null;
  videos: string[] | null;
  location_province: string;
  location_city: string;
  category: string | null;
  created_at: string;
}

interface StorefrontPostRow {
  id: string;
  title: string;
  type: string;
  body: string | null;
  created_at: string;
  storefronts: { id: string; mall_name: string }[] | null;
}

interface BusinessPostRow {
  id: string;
  title: string;
  type: string;
  body: string | null;
  created_at: string;
  business_profiles: { id: string; business_name: string }[] | null;
}

/** Simple relative-time helper to avoid date-fns dependency */
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const metadata = {
  title: "Promotions — Special Deals & Featured Listings | VerifyMzansi",
  description:
    "Discover promoted listings, special deals, events and offers from verified sellers across South Africa.",
};

export const dynamic = "force-dynamic";
export const revalidate = 60;

export default async function PromotionsPage() {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // ── Fetch all promoted content in parallel ─────────────────
  const [featuredRes, urgentRes, boostedRes, storefrontPostsRes, businessPostsRes] =
    await Promise.all([
      // Featured listings
      admin
        .from("listings")
        .select(
          "id, title, price_cents, photos, videos, location_province, location_city, category, created_at, featured_until, area"
        )
        .eq("status", "live")
        .gt("featured_until", now)
        .order("featured_until", { ascending: false })
        .limit(12),

      // Urgent listings
      admin
        .from("listings")
        .select(
          "id, title, price_cents, photos, videos, location_province, location_city, category, created_at, urgent_until, area"
        )
        .eq("status", "live")
        .gt("urgent_until", now)
        .order("urgent_until", { ascending: false })
        .limit(12),

      // Boosted listings
      admin
        .from("listings")
        .select(
          "id, title, price_cents, photos, videos, location_province, location_city, category, created_at, boost_until, area"
        )
        .eq("status", "live")
        .gt("boost_until", now)
        .order("boost_until", { ascending: false })
        .limit(12),

      // Storefront posts (promotions, events)
      admin
        .from("storefront_posts")
        .select("id, title, body, type, created_at, storefronts:storefront_id(id, mall_name)")
        .eq("status", "live")
        .in("type", ["promotion", "event", "special"])
        .order("created_at", { ascending: false })
        .limit(12),

      // Business posts (offers, hiring)
      admin
        .from("business_posts")
        .select(
          "id, title, body, type, created_at, business_profiles:business_profile_id(id, business_name)"
        )
        .eq("status", "live")
        .in("type", ["offer", "hiring", "case_study"])
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

  const featured = (featuredRes.data ?? []) as unknown as PromotedListing[];
  const urgent = (urgentRes.data ?? []) as unknown as PromotedListing[];
  const boosted = (boostedRes.data ?? []) as unknown as PromotedListing[];
  const storefrontPosts = (storefrontPostsRes.data ?? []) as unknown as StorefrontPostRow[];
  const businessPosts = (businessPostsRes.data ?? []) as unknown as BusinessPostRow[];

  const hasContent =
    featured.length > 0 ||
    urgent.length > 0 ||
    boosted.length > 0 ||
    storefrontPosts.length > 0 ||
    businessPosts.length > 0;

  return (
    <div className="container mx-auto px-4 py-8 space-y-10 max-w-7xl">
      <PageHeader
        title="Promotions & Deals"
        description="Special deals, featured listings, events and offers from verified sellers across Mzansi."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Promotions" }]}
      />

      {/* ── Advertise CTA Banner ────────────────────────────── */}
      <Card className="bg-gradient-to-r from-brand-green/10 to-brand-gold/10 border-brand-green/20">
        <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-display font-semibold text-lg">
              Want to advertise or promote on VerifyMzansi?
            </h3>
            <p className="text-sm text-muted-foreground">
              Boost your listings, feature your shop, or run promotions to reach verified buyers
              across South Africa.
            </p>
          </div>
          <Button asChild className="shrink-0 gap-1">
            <Link href="/post/create">
              Start Advertising
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {!hasContent ? (
        <Card>
          <CardContent className="p-12 text-center space-y-4">
            <Megaphone className="h-10 w-10 text-muted-foreground mx-auto" />
            <h3 className="font-display text-lg font-semibold">No active promotions right now</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              When sellers promote their listings, shops, or services, they&apos;ll appear here.
              Check back soon for deals!
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Urgent Listings ───────────────────────────────── */}
          {urgent.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-red-500" />
                <h2 className="text-xl font-display font-semibold">Urgent Listings</h2>
                <Badge variant="destructive" className="text-xs">
                  Time-sensitive
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {urgent.map((listing: PromotedListing) => (
                  <ListingCard
                    key={listing.id}
                    id={listing.id}
                    title={listing.title}
                    price={listing.price_cents}
                    imageUrl={listing.videos?.[0] || listing.photos?.[0]}
                    province={listing.location_province}
                    city={listing.location_city}
                    category={listing.category ?? ""}
                    createdAt={listing.created_at}
                    urgent
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Featured Listings ─────────────────────────────── */}
          {featured.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500" />
                <h2 className="text-xl font-display font-semibold">Featured Listings</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {featured.map((listing: PromotedListing) => (
                  <ListingCard
                    key={listing.id}
                    id={listing.id}
                    title={listing.title}
                    price={listing.price_cents}
                    imageUrl={listing.videos?.[0] || listing.photos?.[0]}
                    province={listing.location_province}
                    city={listing.location_city}
                    category={listing.category ?? ""}
                    createdAt={listing.created_at}
                    featured
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Boosted Listings ──────────────────────────────── */}
          {boosted.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-orange-500" />
                <h2 className="text-xl font-display font-semibold">Boosted Listings</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {boosted.map((listing: PromotedListing) => (
                  <ListingCard
                    key={listing.id}
                    id={listing.id}
                    title={listing.title}
                    price={listing.price_cents}
                    imageUrl={listing.videos?.[0] || listing.photos?.[0]}
                    province={listing.location_province}
                    city={listing.location_city}
                    category={listing.category ?? ""}
                    createdAt={listing.created_at}
                    boosted
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Storefront Promotions ─────────────────────────── */}
          {storefrontPosts.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Store className="h-5 w-5 text-brand-gold-700" />
                <h2 className="text-xl font-display font-semibold">Shop Promotions & Events</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {storefrontPosts.map((post: StorefrontPostRow) => (
                  <Card key={post.id} className="hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base line-clamp-2">{post.title}</CardTitle>
                        <Badge variant="outline" className="shrink-0 capitalize">
                          {post.type}
                        </Badge>
                      </div>
                      {post.storefronts?.[0] && (
                        <Link
                          href={`/mall-shop/${post.storefronts[0].id}`}
                          className="text-xs text-brand-gold-700 hover:underline"
                        >
                          {post.storefronts[0].mall_name}
                        </Link>
                      )}
                    </CardHeader>
                    <CardContent>
                      {post.body && (
                        <p className="text-sm text-muted-foreground line-clamp-3">{post.body}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        {timeAgo(post.created_at)}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* ── Business Offers & Opportunities ───────────────── */}
          {businessPosts.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-brand-blue" />
                <h2 className="text-xl font-display font-semibold">
                  Business Offers & Opportunities
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {businessPosts.map((post: BusinessPostRow) => (
                  <Card key={post.id} className="hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base line-clamp-2">{post.title}</CardTitle>
                        <Badge variant="outline" className="shrink-0 capitalize">
                          {post.type?.replace("_", " ")}
                        </Badge>
                      </div>
                      {post.business_profiles?.[0] && (
                        <Link
                          href={`/business-ads/${post.business_profiles[0].id}`}
                          className="text-xs text-brand-blue hover:underline"
                        >
                          {post.business_profiles[0].business_name}
                        </Link>
                      )}
                    </CardHeader>
                    <CardContent>
                      {post.body && (
                        <p className="text-sm text-muted-foreground line-clamp-3">{post.body}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        {timeAgo(post.created_at)}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
