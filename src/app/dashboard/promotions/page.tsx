import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Megaphone, Star, Zap, Flame, Clock, Store, Briefcase } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";

/** Simple relative-time helper */
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ---------- row shapes from Supabase queries ---------- */
interface DashboardListing {
  id: string;
  title: string;
  area: string;
  boost_until?: string;
  featured_until?: string;
  urgent_until?: string;
}

interface DashboardPost {
  id: string;
  title: string;
  type: string;
  created_at: string;
  storefronts?: { id: string; mall_name: string }[] | null;
  business_profiles?: { id: string; business_name: string }[] | null;
}

function expiresIn(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return "expired";
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `${days}d left`;
}

export const metadata = {
  title: "My Promotions | VerifyMzansi",
};

export default async function MyPromotionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const now = new Date().toISOString();

  // ── Fetch all user's active promotions in parallel ───────
  const [boostedRes, featuredRes, urgentRes, storefrontPostsRes, businessPostsRes] =
    await Promise.all([
      // Boosted listings
      supabase
        .from("listings")
        .select("id, title, boost_until, area")
        .eq("seller_id", user.id)
        .eq("status", "live")
        .gt("boost_until", now)
        .order("boost_until", { ascending: true }),

      // Featured listings
      supabase
        .from("listings")
        .select("id, title, featured_until, area")
        .eq("seller_id", user.id)
        .eq("status", "live")
        .gt("featured_until", now)
        .order("featured_until", { ascending: true }),

      // Urgent listings
      supabase
        .from("listings")
        .select("id, title, urgent_until, area")
        .eq("seller_id", user.id)
        .eq("status", "live")
        .gt("urgent_until", now)
        .order("urgent_until", { ascending: true }),

      // Storefront posts
      supabase
        .from("storefront_posts")
        .select("id, title, type, created_at, storefronts:storefront_id(id, mall_name)")
        .eq("seller_id", user.id)
        .eq("status", "live")
        .order("created_at", { ascending: false })
        .limit(20),

      // Business posts
      supabase
        .from("business_posts")
        .select(
          "id, title, type, created_at, business_profiles:business_profile_id(id, business_name)"
        )
        .eq("seller_id", user.id)
        .eq("status", "live")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const boosted = (boostedRes.data ?? []) as unknown as DashboardListing[];
  const featured = (featuredRes.data ?? []) as unknown as DashboardListing[];
  const urgent = (urgentRes.data ?? []) as unknown as DashboardListing[];
  const storefrontPosts = (storefrontPostsRes.data ?? []) as unknown as DashboardPost[];
  const businessPosts = (businessPostsRes.data ?? []) as unknown as DashboardPost[];

  const totalActive =
    boosted.length +
    featured.length +
    urgent.length +
    storefrontPosts.length +
    businessPosts.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Promotions"
        description="Track your active boosts, featured listings, and promotional posts."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Promotions" }]}
      >
        <Button asChild size="sm" variant="outline" className="gap-1">
          <Link href="/promotions">
            <Megaphone className="h-4 w-4" />
            View Public Promotions
          </Link>
        </Button>
      </PageHeader>

      {totalActive === 0 ? (
        <Card>
          <CardContent className="p-12 text-center space-y-4">
            <Megaphone className="h-10 w-10 text-muted-foreground mx-auto" />
            <h3 className="font-display text-lg font-semibold">No active promotions</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Boost, feature, or mark your listings as urgent to get more visibility. You can also
              create posts from your storefronts and business profiles.
            </p>
            <div className="flex justify-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/listings">Manage Listings</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/storefronts">My Storefronts</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* ── Urgent Listings ────────────────────────────── */}
          {urgent.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-display font-semibold flex items-center gap-2">
                <Zap className="h-5 w-5 text-red-500" />
                Urgent Listings ({urgent.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {urgent.map((l: DashboardListing) => (
                  <Card key={l.id}>
                    <CardContent className="flex items-center justify-between py-4">
                      <div>
                        <p className="font-medium text-sm">{l.title}</p>
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          Expires {expiresIn(l.urgent_until!)}
                        </div>
                      </div>
                      <Badge variant="destructive">Urgent</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* ── Featured Listings ──────────────────────────── */}
          {featured.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-display font-semibold flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500" />
                Featured Listings ({featured.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {featured.map((l: DashboardListing) => (
                  <Card key={l.id}>
                    <CardContent className="flex items-center justify-between py-4">
                      <div>
                        <p className="font-medium text-sm">{l.title}</p>
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          Expires {expiresIn(l.featured_until!)}
                        </div>
                      </div>
                      <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                        Featured
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* ── Boosted Listings ───────────────────────────── */}
          {boosted.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-display font-semibold flex items-center gap-2">
                <Flame className="h-5 w-5 text-orange-500" />
                Boosted Listings ({boosted.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {boosted.map((l: DashboardListing) => (
                  <Card key={l.id}>
                    <CardContent className="flex items-center justify-between py-4">
                      <div>
                        <p className="font-medium text-sm">{l.title}</p>
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          Expires {expiresIn(l.boost_until!)}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-orange-600">
                        Boosted
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* ── Storefront Posts ────────────────────────────── */}
          {storefrontPosts.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-display font-semibold flex items-center gap-2">
                <Store className="h-5 w-5 text-brand-gold-700" />
                Storefront Posts ({storefrontPosts.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {storefrontPosts.map((p: DashboardPost) => (
                  <Card key={p.id}>
                    <CardContent className="flex items-center justify-between py-4">
                      <div>
                        <p className="font-medium text-sm">{p.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {p.storefronts?.[0]?.mall_name} &middot; {timeAgo(p.created_at)}
                        </p>
                      </div>
                      <Badge variant="outline" className="capitalize">
                        {p.type}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* ── Business Posts ──────────────────────────────── */}
          {businessPosts.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-display font-semibold flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-brand-blue" />
                Business Posts ({businessPosts.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {businessPosts.map((p: DashboardPost) => (
                  <Card key={p.id}>
                    <CardContent className="flex items-center justify-between py-4">
                      <div>
                        <p className="font-medium text-sm">{p.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {p.business_profiles?.[0]?.business_name} &middot; {timeAgo(p.created_at)}
                        </p>
                      </div>
                      <Badge variant="outline" className="capitalize">
                        {p.type?.replace("_", " ")}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
