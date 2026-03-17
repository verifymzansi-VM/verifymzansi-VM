import React from "react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye, Pencil, Plus, XCircle, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRelativeTime, formatZAR } from "@/lib/utils/format";
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
import { applyOwnerFilter, getOwnerColumn } from "@/lib/account/compat";
import { getActivePlanTierForArea } from "@/lib/services/plan-tier";
import { queryWithSelectFallbacks } from "@/lib/utils/marketplace-select-fallback";
import { AREA_LABELS, type MarketplaceArea, type PlanTier } from "@/types/enums";

const LISTING_DASHBOARD_FALLBACK_FIELDS = ["featured_until", "urgent_until"] as const;

export const metadata = {
  title: "My Listings",
  description:
    "Manage your marketplace content across Mzansi Market, Mzansi Business, and Promotions.",
};

type DashboardItem = {
  id: string;
  status: string;
  title: string;
  price_cents?: number | null;
  category?: string | null;
  created_at?: string | null;
  area: MarketplaceArea;
  view_count?: number | null;
  photos?: string[];
  boost_until?: string | null;
  featured_until?: string | null;
  urgent_until?: string | null;
  status_reason?: string | null;
};

type BusinessDashboardRow = {
  id: string;
  business_name?: string | null;
  status: string;
  category?: string | null;
  created_at?: string | null;
  cover_photo?: string | null;
  logo_url?: string | null;
  gallery_photos?: string[] | null;
  boost_until?: string | null;
  featured_until?: string | null;
  status_reason?: string | null;
};

function sortByNewest(items: DashboardItem[]) {
  return [...items].sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  });
}

function toDashboardItems(input: unknown): DashboardItem[] {
  return Array.isArray(input) ? (input as DashboardItem[]) : [];
}

function getEditHref(area: MarketplaceArea, id: string) {
  switch (area) {
    case "MZANSI_BUSINESS":
      return `/post/edit-business/${id}`;
    case "PROMOTIONS_EVENTS":
      return `/post/edit-promotion/${id}`;
    case "BUSINESS_ADS":
      return `/post/edit-business-ad/${id}`;
    case "MALL_SHOPS":
      return `/post/edit-mall-shop/${id}`;
    case "MZANSI_MARKET":
    default:
      return `/post/edit-listing/${id}`;
  }
}

function getDisplayPrice(item: DashboardItem) {
  if (typeof item.price_cents === "number" && item.price_cents > 0) {
    return formatZAR(item.price_cents);
  }

  return AREA_LABELS[item.area];
}

export default async function ListingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
    return null;
  }

  const [listingOwnerColumn, businessOwnerColumn, promotionOwnerColumn] = await Promise.all([
    getOwnerColumn(supabase, "listings"),
    getOwnerColumn(supabase, "businesses"),
    getOwnerColumn(supabase, "promotions"),
  ]);

  const listingSelectAttempts = [
    {
      select:
        "id, title, status, price_cents, category, created_at, area, photos, boost_until, featured_until, urgent_until, status_reason",
      omittedFields: [] as const,
    },
    {
      select:
        "id, title, status, price_cents, category, created_at, area, photos, boost_until, featured_until, status_reason",
      omittedFields: ["urgent_until"] as const,
    },
    {
      select:
        "id, title, status, price_cents, category, created_at, area, photos, boost_until, status_reason",
      omittedFields: ["featured_until", "urgent_until"] as const,
    },
  ] as const;

  const [listingResponse, businessResponse, promotionResponse] = await Promise.all([
    queryWithSelectFallbacks({
      attempts: listingSelectAttempts,
      fallbackFields: LISTING_DASHBOARD_FALLBACK_FIELDS,
      runQuery: (selectClause) =>
        applyOwnerFilter(
          supabase.from("listings").select(selectClause).order("created_at", { ascending: false }),
          listingOwnerColumn,
          user.id
        ),
    }),
    applyOwnerFilter(
      supabase
        .from("businesses")
        .select(
          "id, business_name, status, category, created_at, cover_photo, logo_url, gallery_photos, boost_until, featured_until, status_reason"
        )
        .order("created_at", { ascending: false }),
      businessOwnerColumn,
      user.id
    ),
    applyOwnerFilter(
      supabase
        .from("promotions")
        .select(
          "id, title, status, price_cents, category, created_at, photos, view_count, boost_until, featured_until, status_reason"
        )
        .order("created_at", { ascending: false }),
      promotionOwnerColumn,
      user.id
    ),
  ]);

  const items = sortByNewest([
    ...toDashboardItems(listingResponse.data).map((listing) => ({
      ...listing,
      featured_until: listing.featured_until ?? null,
      urgent_until: listing.urgent_until ?? null,
      view_count: listing.view_count ?? null,
    })),
    ...(Array.isArray(businessResponse.data)
      ? (businessResponse.data as BusinessDashboardRow[])
      : []
    ).map((business) => ({
      id: business.id,
      title: business.business_name || "Untitled business",
      status: business.status,
      category: business.category,
      created_at: business.created_at,
      area: "MZANSI_BUSINESS" as const,
      photos: [
        business.cover_photo,
        business.logo_url,
        ...(Array.isArray(business.gallery_photos) ? business.gallery_photos : []),
      ].filter(Boolean) as string[],
      boost_until: business.boost_until,
      featured_until: business.featured_until,
      status_reason: business.status_reason,
      price_cents: null,
      view_count: null,
      urgent_until: null,
    })),
    ...toDashboardItems(promotionResponse.data).map((promotion) => ({
      ...promotion,
      area: "PROMOTIONS_EVENTS" as const,
      photos: Array.isArray(promotion.photos) ? promotion.photos : [],
      urgent_until: null,
    })),
  ]);

  const active = items.filter((item) => item.status === "active" || item.status === "live");
  const pending = items.filter(
    (item) => item.status === "pending_review" || item.status === "pending_moderation"
  );
  const expired = items.filter((item) => item.status === "expired" || item.status === "sold");
  const rejected = items.filter((item) => item.status === "rejected");

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
        description="Manage your marketplace content."
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

function RejectedListingList({ listings }: { listings: DashboardItem[] }) {
  if (!listings.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
        <XCircle className="h-8 w-8 opacity-30" />
        <p>No rejected listings — keep up the good work!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {listings.map((listing) => (
        <Card key={listing.id} className="border-destructive/30">
          <CardContent className="flex flex-col gap-3 py-4">
            <div className="flex items-center gap-4">
              <Thumbnail item={listing} muted />

              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm truncate">{listing.title}</h3>
                <p className="text-sm font-bold text-brand-green">{getDisplayPrice(listing)}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span>{listing.category || AREA_LABELS[listing.area]}</span>
                  <span>&middot;</span>
                  <span>{formatRelativeTime(listing.created_at || new Date().toISOString())}</span>
                  <span>&middot;</span>
                  <Badge variant="destructive" className="text-[10px]">
                    Rejected
                  </Badge>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Edit ${listing.title}`}
                >
                  <Link href={getEditHref(listing.area, listing.id)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <XCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-destructive">Reason for rejection</p>
                <p className="text-muted-foreground mt-0.5">
                  {listing.status_reason ||
                    "This item was rejected. No specific reason was provided."}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <ResubmitButton itemId={listing.id} area={listing.area} />
              <DeletePostButton itemId={listing.id} area={listing.area} />
              <p className="text-xs text-muted-foreground">
                Edit your content then resubmit for review
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
  listings: DashboardItem[];
  planTiers: Record<MarketplaceArea, PlanTier>;
}) {
  if (!listings.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
        <Package className="h-8 w-8 opacity-30" />
        <p>No listings in this category.</p>
        <Link href="/post/create">
          <Button size="sm" variant="outline" className="mt-1">
            <Plus className="h-4 w-4 mr-1" /> Create Listing
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {listings.map((listing) => (
        <Card key={listing.id}>
          <CardContent className="flex items-center gap-4 py-4">
            <Thumbnail item={listing} />

            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-sm truncate">{listing.title}</h3>
              <p className="text-sm font-bold text-brand-green">{getDisplayPrice(listing)}</p>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <span>{listing.category || AREA_LABELS[listing.area]}</span>
                <span>·</span>
                <span>{formatRelativeTime(listing.created_at || new Date().toISOString())}</span>
                <span>·</span>
                <Badge variant="default" className="text-[10px]">
                  {AREA_LABELS[listing.area]}
                </Badge>
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {listing.view_count || 0}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <BoostButton
                listingId={listing.id}
                isBoosted={listing.boost_until ? new Date(listing.boost_until) > new Date() : false}
                canBoost={
                  (listing.status === "active" || listing.status === "live") &&
                  checkCanBoost(planTiers[listing.area], listing.area).allowed
                }
              />
              <FeaturedButton
                listingId={listing.id}
                isFeatured={
                  listing.featured_until ? new Date(listing.featured_until) > new Date() : false
                }
                canFeature={
                  (listing.status === "active" || listing.status === "live") &&
                  checkCanFeatured(planTiers[listing.area], listing.area).allowed
                }
              />
              <UrgentButton
                listingId={listing.id}
                isUrgent={
                  listing.urgent_until ? new Date(listing.urgent_until) > new Date() : false
                }
                canMarkUrgent={
                  listing.area === "MZANSI_MARKET" &&
                  (listing.status === "active" || listing.status === "live") &&
                  checkCanUrgent(planTiers[listing.area], listing.area).allowed
                }
              />
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`Edit ${listing.title}`}
              >
                <Link href={getEditHref(listing.area, listing.id)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <DeletePostButton itemId={listing.id} area={listing.area} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Thumbnail({ item, muted = false }: { item: DashboardItem; muted?: boolean }) {
  return (
    <div
      className={`w-16 h-16 rounded-lg bg-warm-100 dark:bg-warm-800 overflow-hidden flex-shrink-0 ${
        muted ? "opacity-60" : ""
      }`}
    >
      {item.photos?.[0] ? (
        <Image
          src={normalizeMediaUrl(item.photos[0])}
          alt={item.title || "Listing thumbnail"}
          width={64}
          height={64}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="flex items-center justify-center h-full text-xs text-warm-400 dark:text-warm-500">
          No img
        </div>
      )}
    </div>
  );
}
