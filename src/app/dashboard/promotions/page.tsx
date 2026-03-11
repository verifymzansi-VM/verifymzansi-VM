import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Megaphone, Star, Zap, Flame, Clock, Tag, Building2, Pencil, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { timeAgo, expiresIn } from "@/lib/utils/format";
import { PROMOTION_TYPE_LABELS, type PromotionType } from "@/types/enums";

interface DashboardListing {
  id: string;
  title: string;
  area: string;
  boost_until?: string;
  featured_until?: string;
  urgent_until?: string;
}

interface DashboardPromotion {
  id: string;
  title: string;
  promotion_type: string;
  business_id: string | null;
  status: string;
  boost_until: string | null;
  featured_until: string | null;
  created_at: string;
}

export const metadata = {
  title: "My Promotions",
  description: "Manage your promotions, ads, and event listings on VerifyMzansi.",
};

export default async function MyPromotionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const now = new Date().toISOString();
  const admin = createAdminClient();

  // ── Fetch all user's active promotions in parallel ───────
  const [boostedRes, featuredRes, urgentRes, myPromotionsRes] = await Promise.all([
    // Boosted listings
    supabase
      .from("listings")
      .select("id, title, boost_until, area")
      .eq("owner_id", user.id)
      .eq("status", "live")
      .gt("boost_until", now)
      .order("boost_until", { ascending: true }),

    // Featured listings
    supabase
      .from("listings")
      .select("id, title, featured_until, area")
      .eq("owner_id", user.id)
      .eq("status", "live")
      .gt("featured_until", now)
      .order("featured_until", { ascending: true }),

    // Urgent listings
    supabase
      .from("listings")
      .select("id, title, urgent_until, area")
      .eq("owner_id", user.id)
      .eq("status", "live")
      .gt("urgent_until", now)
      .order("urgent_until", { ascending: true }),

    // User's promotions (unified — includes migrated storefront_posts + business_posts)
    admin
      .from("promotions")
      .select(
        "id, title, promotion_type, business_id, status, boost_until, featured_until, created_at"
      )
      .eq("owner_id", user.id)
      .in("status", ["live", "pending_moderation", "draft"])
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const boosted = (boostedRes.data ?? []) as unknown as DashboardListing[];
  const featured = (featuredRes.data ?? []) as unknown as DashboardListing[];
  const urgent = (urgentRes.data ?? []) as unknown as DashboardListing[];
  const myPromotions = (myPromotionsRes.data ?? []) as unknown as DashboardPromotion[];

  // Gather linked business names
  const businessIds = [
    ...new Set(myPromotions.map((p) => p.business_id).filter(Boolean)),
  ] as string[];
  const { data: businesses } = businessIds.length
    ? await admin.from("businesses").select("id, business_name").in("id", businessIds)
    : { data: [] };

  const businessMap = new Map((businesses ?? []).map((b) => [b.id, b.business_name]));

  const totalActive = boosted.length + featured.length + urgent.length + myPromotions.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Promotions"
        description="Track boosts, features, and promotions."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Promotions" }]}
      >
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline" className="gap-1">
            <Link href="/promotions">
              <Megaphone className="h-4 w-4" />
              View Public Promotions
            </Link>
          </Button>
          <Button asChild size="sm" className="gap-1">
            <Link href="/post/create-promotion">
              <Plus className="h-4 w-4" />
              New Promotion
            </Link>
          </Button>
        </div>
      </PageHeader>

      {totalActive === 0 ? (
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <Megaphone className="h-8 w-8 text-muted-foreground mx-auto" />
            <h2 className="font-display text-lg font-semibold">No active promotions</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Boost your listings or create promotions to reach more buyers.
            </p>
            <div className="flex justify-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/listings">Manage Listings</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/post/create-promotion">Create Promotion</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* ── Urgent Listings ────────────────────────────── */}
          {urgent.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-display font-semibold flex items-center gap-2">
                <Zap className="h-5 w-5 text-red-500" />
                Urgent Listings ({urgent.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {urgent.map((l) => (
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
                {featured.map((l) => (
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
                {boosted.map((l) => (
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

          {/* ── My Promotions ─────────────────────────────── */}
          {myPromotions.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-display font-semibold flex items-center gap-2">
                <Tag className="h-5 w-5 text-brand-green" />
                My Promotions ({myPromotions.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {myPromotions.map((p) => {
                  const businessName = p.business_id ? businessMap.get(p.business_id) : undefined;
                  const isBoosted = p.boost_until && new Date(p.boost_until) > new Date();
                  const isFeatured = p.featured_until && new Date(p.featured_until) > new Date();

                  return (
                    <Card key={p.id}>
                      <CardContent className="flex items-center justify-between py-4">
                        <div className="flex-1 min-w-0">
                          <Link
                            href={`/promotion/${p.id}`}
                            className="font-medium text-sm hover:text-brand-green transition-colors line-clamp-1"
                          >
                            {p.title}
                          </Link>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <span className="capitalize">
                              {PROMOTION_TYPE_LABELS[p.promotion_type as PromotionType] ||
                                p.promotion_type}
                            </span>
                            <span>&middot;</span>
                            <span>{timeAgo(p.created_at)}</span>
                            {businessName && (
                              <>
                                <span>&middot;</span>
                                <span className="flex items-center gap-1 text-brand-blue">
                                  <Building2 className="h-3 w-3" />
                                  {businessName}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-2 shrink-0">
                          {p.status === "pending_moderation" && (
                            <Badge variant="secondary">Pending</Badge>
                          )}
                          {p.status === "draft" && <Badge variant="outline">Draft</Badge>}
                          {isBoosted && (
                            <Badge variant="outline" className="text-orange-600">
                              Boosted
                            </Badge>
                          )}
                          {isFeatured && (
                            <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                              Featured
                            </Badge>
                          )}
                          <Button
                            asChild
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            aria-label="Edit promotion"
                          >
                            <Link href={`/post/edit-promotion/${p.id}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
