import React from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Eye, Pencil, XCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatZAR, formatRelativeTime } from "@/lib/utils/format";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { BoostButton } from "@/components/listings/boost-button";
import { FeaturedButton } from "@/components/listings/featured-button";
import { UrgentButton } from "@/components/listings/urgent-button";
import { ResubmitButton } from "@/components/listings/resubmit-button";
import { DeletePostButton } from "@/components/listings/delete-post-button";
import {
  canBoost as checkCanBoost,
  canFeatured as checkCanFeatured,
  canUrgent as checkCanUrgent,
} from "@/lib/services/entitlements";
import { getActivePlanTierForArea } from "@/lib/services/plan-tier";
import type { PlanTier, MarketplaceArea } from "@/types/enums";

export const metadata = {
  title: "My Listings | VerifyMzansi",
};

export default async function ListingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
    return null;
  }

  type BaseListing = {
    id: string;
    status: string;
    title?: string;
    price_cents?: number;
    category?: string;
    created_at?: string;
    area?: string;
    view_count?: number;
    photos?: string[];
    videos?: string[];
    boost_until?: string | null;
    featured_until?: string | null;
    urgent_until?: string | null;
    status_reason?: string | null;
  };

  let listings: BaseListing[] = [];
  if (user) {
    const { data } = await supabase
      .from("listings")
      .select("*")
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false });
    listings = data || [];
  }

  const active = listings.filter((l) => l.status === "active" || l.status === "live");
  const pending = listings.filter(
    (l) => l.status === "pending_review" || l.status === "pending_moderation"
  );
  const expired = listings.filter((l) => l.status === "expired" || l.status === "sold");
  const rejected = listings.filter((l) => l.status === "rejected");

  const [mzansiTier, businessTier, mallTier, mzansiBusinessTier, promotionsTier] =
    await Promise.all([
      getActivePlanTierForArea(user.id, "MZANSI_MARKET"),
      getActivePlanTierForArea(user.id, "BUSINESS_ADS"),
      getActivePlanTierForArea(user.id, "MALL_SHOPS"),
      getActivePlanTierForArea(user.id, "MZANSI_BUSINESS"),
      getActivePlanTierForArea(user.id, "PROMOTIONS_EVENTS"),
    ]);

  const planTiers: Record<MarketplaceArea, PlanTier> = {
    MZANSI_MARKET: mzansiTier,
    BUSINESS_ADS: businessTier,
    MALL_SHOPS: mallTier,
    MZANSI_BUSINESS: mzansiBusinessTier,
    PROMOTIONS_EVENTS: promotionsTier,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Listings"
        description="Manage your classified ads across all marketplace areas."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Listings" }]}
      >
        <Button asChild variant="trust-verified" size="sm" className="gap-2">
          <Link href="/post/create">
            <Plus className="h-4 w-4" />
            New Listing
          </Link>
        </Button>
      </PageHeader>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="rejected">
            Rejected{rejected.length > 0 ? ` (${rejected.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="expired">Expired ({expired.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          <ListingList listings={active} planTiers={planTiers} />
        </TabsContent>
        <TabsContent value="pending" className="mt-4">
          <ListingList listings={pending} planTiers={planTiers} />
        </TabsContent>
        <TabsContent value="rejected" className="mt-4">
          <RejectedListingList listings={rejected} />
        </TabsContent>
        <TabsContent value="expired" className="mt-4">
          <ListingList listings={expired} planTiers={planTiers} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type BaseListing = {
  id: string;
  status: string;
  title?: string;
  price_cents?: number;
  category?: string;
  created_at?: string;
  area?: string;
  view_count?: number;
  photos?: string[];
  videos?: string[];
  boost_until?: string | null;
  featured_until?: string | null;
  urgent_until?: string | null;
  status_reason?: string | null;
};

function RejectedListingList({ listings }: { listings: BaseListing[] }) {
  if (!listings.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No rejected listings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {listings.map((listing) => (
        <Card key={listing.id} className="border-destructive/30">
          <CardContent className="flex flex-col gap-3 py-4">
            <div className="flex items-center gap-4">
              {/* Thumbnail */}
              <div className="w-16 h-16 rounded-lg bg-warm-100 dark:bg-warm-800 overflow-hidden flex-shrink-0 opacity-60">
                {listing.photos?.[0] ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={normalizeMediaUrl(listing.photos[0])}
                    alt={listing.title || "Listing thumbnail"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-xs text-warm-400">
                    No img
                  </div>
                )}
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm truncate">{listing.title}</h3>
                <p className="text-sm font-bold text-brand-green">
                  {formatZAR(listing.price_cents || 0)}
                </p>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span>{listing.category}</span>
                  <span>&middot;</span>
                  <span>{formatRelativeTime(listing.created_at || new Date().toISOString())}</span>
                  <span>&middot;</span>
                  <Badge variant="destructive" className="text-[10px]">
                    Rejected
                  </Badge>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                  <Link
                    href={
                      listing.area === "BUSINESS_ADS"
                        ? `/post/edit-business-ad/${listing.id}`
                        : listing.area === "MALL_SHOPS"
                          ? `/post/edit-mall-shop/${listing.id}`
                          : `/post/edit-listing/${listing.id}`
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>

            {/* Rejection reason banner */}
            {listing.status_reason && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
                <XCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-destructive">Reason for rejection</p>
                  <p className="text-muted-foreground mt-0.5">{listing.status_reason}</p>
                </div>
              </div>
            )}
            {!listing.status_reason && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
                <XCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                <p className="text-sm text-muted-foreground">
                  This listing was rejected. No specific reason was provided.
                </p>
              </div>
            )}

            {/* Resubmit action */}
            <div className="flex items-center gap-2 pt-1">
              <ResubmitButton
                itemId={listing.id}
                area={
                  (listing.area as
                    | "MZANSI_MARKET"
                    | "BUSINESS_ADS"
                    | "MALL_SHOPS"
                    | "PROMOTIONS_EVENTS") || "MZANSI_MARKET"
                }
              />
              <DeletePostButton
                itemId={listing.id}
                area={
                  (listing.area as
                    | "MZANSI_MARKET"
                    | "BUSINESS_ADS"
                    | "MALL_SHOPS"
                    | "PROMOTIONS_EVENTS") || "MZANSI_MARKET"
                }
              />
              <p className="text-xs text-muted-foreground">
                Edit your listing then resubmit for review
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ListingList({
  listings,
  planTiers,
}: {
  listings: BaseListing[];
  planTiers: Record<MarketplaceArea, PlanTier>;
}) {
  if (!listings.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No listings in this category.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {listings.map((listing) => (
        <Card key={listing.id}>
          <CardContent className="flex items-center gap-4 py-4">
            {/* Thumbnail */}
            <div className="w-16 h-16 rounded-lg bg-warm-100 dark:bg-warm-800 overflow-hidden flex-shrink-0">
              {listing.photos?.[0] ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={normalizeMediaUrl(listing.photos[0])}
                  alt={listing.title || "Listing thumbnail"}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-warm-400">
                  No img
                </div>
              )}
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-sm truncate">{listing.title}</h3>
              <p className="text-sm font-bold text-brand-green">
                {formatZAR(listing.price_cents || 0)}
              </p>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <span>{listing.category}</span>
                <span>·</span>
                <span>{formatRelativeTime(listing.created_at || new Date().toISOString())}</span>
                <span>·</span>
                <Badge variant="default" className="text-[10px]">
                  {listing.area?.replace("_", " ")}
                </Badge>
              </div>
            </div>

            {/* Stats */}
            <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {listing.view_count || 0}
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1">
              <BoostButton
                listingId={listing.id}
                isBoosted={listing.boost_until ? new Date(listing.boost_until) > new Date() : false}
                canBoost={
                  (listing.status === "active" || listing.status === "live") &&
                  (() => {
                    const area = (listing.area || "MZANSI_MARKET") as MarketplaceArea;
                    return checkCanBoost(planTiers[area], area).allowed;
                  })()
                }
              />
              <FeaturedButton
                listingId={listing.id}
                isFeatured={
                  listing.featured_until ? new Date(listing.featured_until) > new Date() : false
                }
                canFeature={
                  (listing.status === "active" || listing.status === "live") &&
                  (() => {
                    const area = (listing.area || "MZANSI_MARKET") as MarketplaceArea;
                    return checkCanFeatured(planTiers[area], area).allowed;
                  })()
                }
              />
              <UrgentButton
                listingId={listing.id}
                isUrgent={
                  listing.urgent_until ? new Date(listing.urgent_until) > new Date() : false
                }
                canMarkUrgent={
                  (listing.status === "active" || listing.status === "live") &&
                  (() => {
                    const area = (listing.area || "MZANSI_MARKET") as MarketplaceArea;
                    return checkCanUrgent(planTiers[area], area).allowed;
                  })()
                }
              />
              <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                <Link
                  href={
                    listing.area === "BUSINESS_ADS"
                      ? `/post/edit-business-ad/${listing.id}`
                      : listing.area === "MALL_SHOPS"
                        ? `/post/edit-mall-shop/${listing.id}`
                        : `/post/edit-listing/${listing.id}`
                  }
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <DeletePostButton
                itemId={listing.id}
                area={
                  (listing.area as
                    | "MZANSI_MARKET"
                    | "BUSINESS_ADS"
                    | "MALL_SHOPS"
                    | "PROMOTIONS_EVENTS") || "MZANSI_MARKET"
                }
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
