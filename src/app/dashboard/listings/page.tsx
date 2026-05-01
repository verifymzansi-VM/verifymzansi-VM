import React, { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye, ExternalLink, Megaphone, Pencil, Plus, XCircle, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AreaFilter } from "@/components/dashboard/area-filter";
import {
  canBoost as checkCanBoost,
  canFeatured as checkCanFeatured,
  canUrgent as checkCanUrgent,
} from "@/lib/services/entitlements";
import { applyOwnerFilter, getOwnerColumn } from "@/lib/account/compat";
import { getActivePlanTierForArea } from "@/lib/services/plan-tier";
import { getOptionalContentViewCountMap } from "@/lib/engagement-server";
import { queryWithSelectFallbacks } from "@/lib/utils/marketplace-select-fallback";
import {
  AREA_LABELS,
  PROMOTION_TYPE_LABELS,
  type MarketplaceArea,
  type PlanTier,
  type PromotionType,
} from "@/types/enums";

const LISTING_DASHBOARD_FALLBACK_FIELDS = ["featured_until", "urgent_until"] as const;

export const metadata = {
  title: "Your Content",
  description:
    "Manage your marketplace content across Mzansi Market, Mzansi Business, and Tourism & Events.",
};

type DashboardItem = {
  id: string;
  status: string;
  title: string;
  price_cents?: number | null;
  category?: string | null;
  created_at?: string | null;
  area: MarketplaceArea;
  /** Which table the item originated from — used for edit/view routing. */
  source: "listing" | "business" | "promotion";
  view_count?: number | null;
  photos?: string[];
  boost_until?: string | null;
  featured_until?: string | null;
  urgent_until?: string | null;
  status_reason?: string | null;
  promotion_type?: string | null;
};

type BusinessDashboardRow = {
  id: string;
  business_name?: string | null;
  status: string;
  category?: string | null;
  created_at?: string | null;
  area?: string | null;
  cover_photo?: string | null;
  logo_url?: string | null;
  gallery_photos?: string[] | null;
  boost_until?: string | null;
  featured_until?: string | null;
  urgent_until?: string | null;
  status_reason?: string | null;
};

type ContentSource = DashboardItem["source"];

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

function getViewCountForItem(
  item: DashboardItem,
  viewCounts: Record<ContentSource, Map<string, number>>
) {
  return viewCounts[item.source].get(item.id) ?? item.view_count ?? null;
}

async function getOwnerViewCountMap(
  admin: ReturnType<typeof tryCreateAdminClient>,
  targetType: ContentSource,
  targetIds: string[]
) {
  if (targetIds.length === 0) {
    return new Map<string, number>();
  }

  const result = await getOptionalContentViewCountMap(admin, targetType, targetIds);
  return result.data;
}

function getEditHref(item: DashboardItem) {
  // Tourism businesses live in the businesses table with area PROMOTIONS_EVENTS;
  // route them to edit-business (not edit-promotion).
  if (item.source === "business") return `/post/edit-business/${item.id}`;
  switch (item.area) {
    case "PROMOTIONS_EVENTS":
      return `/post/edit-tourism/${item.id}`;
    case "BUSINESS_ADS":
      return `/post/edit-business-ad/${item.id}`;
    case "MALL_SHOPS":
      return `/post/edit-mall-shop/${item.id}`;
    case "MZANSI_MARKET":
    default:
      return `/post/edit-listing/${item.id}`;
  }
}

function getDisplayPrice(item: DashboardItem) {
  if (typeof item.price_cents === "number" && item.price_cents > 0) {
    return formatZAR(item.price_cents);
  }

  return AREA_LABELS[item.area];
}

function getViewHref(item: DashboardItem) {
  // Tourism businesses are in the businesses table but live under Tourism & Events publicly.
  if (item.source === "business") {
    return item.area === "PROMOTIONS_EVENTS"
      ? `/tourism-events/${item.id}`
      : `/mzansi-business/${item.id}`;
  }
  switch (item.area) {
    case "PROMOTIONS_EVENTS":
      return `/tourism-events/${item.id}`;
    default:
      return `/listing/${item.id}`;
  }
}

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string; created?: string; updated?: string }>;
}) {
  const { area: areaParam, created, updated } = await searchParams;
  const areaFilter =
    areaParam && ["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"].includes(areaParam)
      ? (areaParam as MarketplaceArea)
      : null;

  const successAlert = updated
    ? {
        title: `${updated === "business" ? "Business" : "Promotion"} updated`,
        description: "Your changes were saved and resubmitted for review.",
      }
    : created
      ? {
          title: `${created === "business" ? "Business" : "Promotion"} submitted`,
          description: "Your post was created successfully and is now waiting for moderation.",
        }
      : null;

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
          "id, business_name, status, category, created_at, area, cover_photo, logo_url, gallery_photos, boost_until, featured_until, urgent_until, status_reason"
        )
        .order("created_at", { ascending: false }),
      businessOwnerColumn,
      user.id
    ),
    applyOwnerFilter(
      supabase
        .from("promotions")
        .select(
          "id, title, status, price_cents, category, created_at, photos, view_count, boost_until, featured_until, urgent_until, status_reason, promotion_type"
        )
        .order("created_at", { ascending: false }),
      promotionOwnerColumn,
      user.id
    ),
  ]);

  const baseItems = [
    ...toDashboardItems(listingResponse.data).map((listing) => ({
      ...listing,
      source: "listing" as const,
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
      area: (business.area === "PROMOTIONS_EVENTS"
        ? "PROMOTIONS_EVENTS"
        : "MZANSI_BUSINESS") as MarketplaceArea,
      source: "business" as const,
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
      urgent_until: business.urgent_until ?? null,
    })),
    ...toDashboardItems(promotionResponse.data).map((promotion) => ({
      ...promotion,
      area: "PROMOTIONS_EVENTS" as const,
      source: "promotion" as const,
      photos: Array.isArray(promotion.photos) ? promotion.photos : [],
      urgent_until: ((promotion as Record<string, unknown>).urgent_until as string | null) ?? null,
      promotion_type:
        ((promotion as Record<string, unknown>).promotion_type as string | null) ?? null,
    })),
  ];

  const engagementAdmin = tryCreateAdminClient();
  const [listingViewCounts, businessViewCounts, promotionViewCounts] = await Promise.all([
    getOwnerViewCountMap(
      engagementAdmin,
      "listing",
      baseItems.filter((item) => item.source === "listing").map((item) => item.id)
    ),
    getOwnerViewCountMap(
      engagementAdmin,
      "business",
      baseItems.filter((item) => item.source === "business").map((item) => item.id)
    ),
    getOwnerViewCountMap(
      engagementAdmin,
      "promotion",
      baseItems.filter((item) => item.source === "promotion").map((item) => item.id)
    ),
  ]);

  const viewCounts: Record<ContentSource, Map<string, number>> = {
    listing: listingViewCounts,
    business: businessViewCounts,
    promotion: promotionViewCounts,
  };

  const items = sortByNewest(
    baseItems.map((item) => ({
      ...item,
      view_count: getViewCountForItem(item, viewCounts),
    }))
  );

  const active = items.filter((item) => item.status === "active" || item.status === "live");
  const pending = items.filter(
    (item) => item.status === "pending_review" || item.status === "pending_moderation"
  );
  const expired = items.filter((item) => item.status === "expired" || item.status === "sold");
  const rejected = items.filter((item) => item.status === "rejected");

  const byArea = (list: DashboardItem[]) =>
    areaFilter ? list.filter((item) => item.area === areaFilter) : list;

  const filteredActive = byArea(active);
  const filteredPending = byArea(pending);
  const filteredExpired = byArea(expired);
  const filteredRejected = byArea(rejected);

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
      {successAlert && (
        <Alert variant="success">
          <div>
            <AlertTitle>{successAlert.title}</AlertTitle>
            <AlertDescription>{successAlert.description}</AlertDescription>
          </div>
        </Alert>
      )}

      <PageHeader
        title="My Posts"
        description="Manage listings, businesses, and promotions from one place."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "My Posts" }]}
      >
        <Button asChild variant="trust-verified" size="sm" className="h-11 gap-2">
          <Link href="/post/create">
            <Plus className="h-4 w-4" />
            Create Post
          </Link>
        </Button>
      </PageHeader>

      <Suspense>
        <AreaFilter />
      </Suspense>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active ({filteredActive.length})</TabsTrigger>
          <TabsTrigger value="pending">Under Review ({filteredPending.length})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({filteredRejected.length})</TabsTrigger>
          <TabsTrigger value="expired">Ended ({filteredExpired.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          <ListingList
            listings={filteredActive}
            planTiers={planTiers}
            emptyStateLabel="No posts yet."
          />
        </TabsContent>
        <TabsContent value="pending" className="mt-4">
          <ListingList
            listings={filteredPending}
            planTiers={planTiers}
            emptyStateLabel="No posts are waiting for review right now."
          />
        </TabsContent>
        <TabsContent value="rejected" className="mt-4">
          <RejectedListingList listings={filteredRejected} />
        </TabsContent>
        <TabsContent value="expired" className="mt-4">
          <ListingList
            listings={filteredExpired}
            planTiers={planTiers}
            emptyStateLabel="No expired or sold posts right now."
          />
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
              <Thumbnail item={listing} muted />

              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm truncate">{listing.title}</h3>
                <p className="text-sm font-bold text-brand-green">{getDisplayPrice(listing)}</p>
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-1 text-xs text-muted-foreground">
                  <span>{listing.category || AREA_LABELS[listing.area]}</span>
                  <span>&middot;</span>
                  <span>{formatRelativeTime(listing.created_at || new Date().toISOString())}</span>
                  <span>&middot;</span>
                  <Badge variant="destructive" className="text-[10px]">
                    Rejected
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {AREA_LABELS[listing.area]}
                  </Badge>
                  {listing.area === "PROMOTIONS_EVENTS" &&
                    listing.promotion_type &&
                    PROMOTION_TYPE_LABELS[listing.promotion_type as PromotionType] && (
                      <Badge variant="secondary" className="text-[10px]">
                        {PROMOTION_TYPE_LABELS[listing.promotion_type as PromotionType]}
                      </Badge>
                    )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11"
                  aria-label={`Edit ${listing.title}`}
                >
                  <Link href={getEditHref(listing)}>
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
  emptyStateLabel = "No posts in this section yet.",
  emptyStateCta = "Create Post",
}: {
  listings: DashboardItem[];
  planTiers: Record<MarketplaceArea, PlanTier>;
  emptyStateLabel?: string;
  emptyStateCta?: string;
}) {
  if (!listings.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
        <Package className="h-8 w-8 opacity-30" />
        <p>{emptyStateLabel}</p>
        <Link href="/post/create">
          <Button size="sm" variant="outline" className="mt-1 h-11">
            <Plus className="h-4 w-4 mr-1" /> {emptyStateCta}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {listings.map((listing) => (
        <Card key={listing.id}>
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Thumbnail item={listing} />

              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm truncate">{listing.title}</h3>
                <p className="text-sm font-bold text-brand-green">{getDisplayPrice(listing)}</p>
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-1 text-xs text-muted-foreground">
                  <span>{listing.category || AREA_LABELS[listing.area]}</span>
                  <span>·</span>
                  <span>{formatRelativeTime(listing.created_at || new Date().toISOString())}</span>
                  <span>·</span>
                  <Badge variant="default" className="text-[10px]">
                    {AREA_LABELS[listing.area]}
                  </Badge>
                  {listing.area === "PROMOTIONS_EVENTS" &&
                    listing.promotion_type &&
                    PROMOTION_TYPE_LABELS[listing.promotion_type as PromotionType] && (
                      <Badge variant="secondary" className="text-[10px]">
                        {PROMOTION_TYPE_LABELS[listing.promotion_type as PromotionType]}
                      </Badge>
                    )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {listing.view_count || 0}
              </span>
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              <BoostButton
                listingId={listing.id}
                isBoosted={listing.boost_until ? new Date(listing.boost_until) > new Date() : false}
                canBoost={
                  (listing.status === "active" || listing.status === "live") &&
                  checkCanBoost(planTiers[listing.area], listing.area).allowed
                }
                itemTypeLabel={listing.source}
                boostApiPath={
                  listing.source === "business"
                    ? `/api/businesses/${listing.id}/boost`
                    : listing.source === "promotion"
                      ? `/api/promotions/${listing.id}/boost`
                      : undefined
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
                itemTypeLabel={listing.source}
                featuredApiPath={
                  listing.source === "business"
                    ? `/api/businesses/${listing.id}/featured`
                    : listing.source === "promotion"
                      ? `/api/promotions/${listing.id}/featured`
                      : undefined
                }
              />
              <UrgentButton
                listingId={listing.id}
                isUrgent={
                  listing.urgent_until ? new Date(listing.urgent_until) > new Date() : false
                }
                canMarkUrgent={
                  (listing.status === "active" || listing.status === "live") &&
                  checkCanUrgent(planTiers[listing.area], listing.area).allowed
                }
                itemTypeLabel={listing.source}
                urgentApiPath={
                  listing.source === "business"
                    ? `/api/businesses/${listing.id}/urgent`
                    : listing.source === "promotion"
                      ? `/api/promotions/${listing.id}/urgent`
                      : undefined
                }
              />
              {listing.source === "business" &&
                (listing.status === "active" || listing.status === "live") && (
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    aria-label={`Promote ${listing.title}`}
                  >
                    <Link href={`/post/create-tourism?business_id=${listing.id}`}>
                      <Megaphone className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                )}
              <Button asChild variant="ghost" size="sm" className="h-11 gap-1.5 px-3">
                <Link href={getViewHref(listing)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  View
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm" className="h-11 gap-1.5 px-3">
                <Link href={getEditHref(listing)}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
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
          className="w-full h-full object-contain"
        />
      ) : (
        <div className="flex items-center justify-center h-full text-xs text-warm-400 dark:text-warm-500">
          No image
        </div>
      )}
    </div>
  );
}
