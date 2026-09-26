import React, { Suspense } from "react";
import {
  DISPLAY_STATUS_LABELS,
  EVENT_LIFECYCLE_LABELS,
  OWNER_DEACTIVATED_REASON,
  eventLifecycle,
  toDisplayContentStatus,
} from "@/lib/posting/content-status";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Eye, ExternalLink, Pencil, Plus, XCircle, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { ExpiryCountdownBadge } from "@/components/dashboard/expiry-countdown-badge";
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
import { ContentLifecycleButton } from "@/components/listings/content-lifecycle-button";
import {
  SlotUsageCard,
  parseSlotUsage,
  type SlotUsageEntry,
} from "@/components/dashboard/slot-usage-card";
import { PostAccountButton } from "@/components/listings/post-account-button";
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
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";

const LISTING_DASHBOARD_FALLBACK_FIELDS = ["view_count", "featured_until", "urgent_until"] as const;
const BUSINESS_DASHBOARD_FALLBACK_FIELDS = ["view_count", "expires_at"] as const;
const PROMOTION_DASHBOARD_FALLBACK_FIELDS = ["view_count", "urgent_until", "expires_at"] as const;

export const metadata = {
  title: "My Posts",
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
  published_at?: string | null;
  area: MarketplaceArea;
  /** Which table the item originated from — used for edit/view routing. */
  source: "listing" | "business" | "promotion";
  view_count?: number | null;
  photos?: string[];
  boost_until?: string | null;
  featured_until?: string | null;
  urgent_until?: string | null;
  expires_at?: string | null;
  status_reason?: string | null;
  promotion_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  /** Visibility funded by an organisation (derived from the slot). */
  sponsored?: boolean;
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
  expires_at?: string | null;
  status_reason?: string | null;
  view_count?: number | null;
};

type ContentSource = DashboardItem["source"];

/** Posts whose active slot is funded by an organisation sponsorship. */
async function loadSponsoredContentIds(
  admin: ReturnType<typeof tryCreateAdminClient>,
  userId: string
): Promise<Set<string>> {
  if (!admin) return new Set();
  try {
    const { data } = await admin
      .from("slot_assignments")
      .select("content_id, slot_entitlements!inner(source)")
      .eq("owner_id", userId)
      .is("released_at", null)
      .eq("slot_entitlements.source", "SPONSORED_ORGANISATION_MEMBER");
    return new Set(((data ?? []) as Array<{ content_id: string }>).map((row) => row.content_id));
  } catch {
    return new Set();
  }
}

/** Slot summary is informational: a failure must never block the dashboard. */
async function loadSlotUsage(
  admin: ReturnType<typeof tryCreateAdminClient>,
  userId: string
): Promise<SlotUsageEntry[]> {
  if (!admin) return [];
  try {
    const result = await admin.rpc("slot_usage_summary", { p_user: userId });
    return parseSlotUsage(result?.data ?? null);
  } catch {
    return [];
  }
}

function dashboardActionLabel(source: ContentSource) {
  return source === "business"
    ? "business profile"
    : source === "promotion"
      ? "Tourism & Events post"
      : "listing";
}

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
  const summaryCount = viewCounts[item.source].get(item.id);
  const tableCount = item.view_count;

  if (typeof summaryCount === "number" && typeof tableCount === "number") {
    return Math.max(summaryCount, tableCount);
  }

  return summaryCount ?? tableCount ?? null;
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

function getViewCountLabel(count: number | null | undefined) {
  const value = count ?? 0;
  return value === 1 ? "view" : "views";
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

function shouldShowExpiryCountdown(item: DashboardItem) {
  return (item.status === "active" || item.status === "live") && !!getPostExpiresAt(item);
}

function addDaysIso(value: string | null | undefined, days: number) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString();
}

function getPostExpiresAt(item: DashboardItem) {
  if (item.expires_at) return item.expires_at;

  if (item.source === "promotion") {
    return addDaysIso(item.published_at ?? item.created_at, FREE_POST_CONFIG.durationDays);
  }

  return addDaysIso(item.created_at, FREE_POST_CONFIG.durationDays);
}

function isExpiredByVisibilityWindow(item: DashboardItem, now = new Date()) {
  if (!(item.status === "active" || item.status === "live")) {
    return false;
  }

  const expiresAt = getPostExpiresAt(item);
  if (!expiresAt) return false;

  const expiryTime = new Date(expiresAt).getTime();
  return Number.isFinite(expiryTime) && expiryTime <= now.getTime();
}

function applyDashboardExpiryStatus(item: DashboardItem, now = new Date()): DashboardItem {
  return isExpiredByVisibilityWindow(item, now)
    ? {
        ...item,
        status: "expired",
        status_reason: item.status_reason ?? "Post visibility period expired",
      }
    : item;
}

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string; created?: string; updated?: string; review?: string }>;
}) {
  const { area: areaParam, created, updated, review } = await searchParams;
  const areaFilter =
    areaParam && ["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"].includes(areaParam)
      ? (areaParam as MarketplaceArea)
      : null;
  const dashboardPostLabel = (kind: string | null) =>
    kind === "business"
      ? "Business"
      : kind === "tourism" || kind === "promotion"
        ? "Tourism & Events post"
        : "Post";

  const successAlert = updated
    ? {
        title: `${dashboardPostLabel(updated)} updated`,
        description:
          review === "pending"
            ? "Your edit is awaiting staff review. The current approved post stays live until approval."
            : "Your changes were saved. Rejected posts must be resubmitted using the Resubmit button.",
      }
    : created
      ? {
          title: `${dashboardPostLabel(created)} submitted`,
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
        "id, title, status, price_cents, category, created_at, area, photos, view_count, boost_until, featured_until, urgent_until, expires_at, status_reason",
      omittedFields: [] as const,
    },
    {
      select:
        "id, title, status, price_cents, category, created_at, area, photos, boost_until, featured_until, urgent_until, expires_at, status_reason",
      omittedFields: ["view_count"] as const,
    },
    {
      select:
        "id, title, status, price_cents, category, created_at, area, photos, view_count, boost_until, featured_until, expires_at, status_reason",
      omittedFields: ["urgent_until"] as const,
    },
    {
      select:
        "id, title, status, price_cents, category, created_at, area, photos, view_count, boost_until, expires_at, status_reason",
      omittedFields: ["featured_until", "urgent_until"] as const,
    },
    {
      select:
        "id, title, status, price_cents, category, created_at, area, photos, boost_until, featured_until, expires_at, status_reason",
      omittedFields: ["view_count", "urgent_until"] as const,
    },
    {
      select:
        "id, title, status, price_cents, category, created_at, area, photos, boost_until, expires_at, status_reason",
      omittedFields: ["view_count", "featured_until", "urgent_until"] as const,
    },
  ] as const;

  const businessSelectAttempts = [
    {
      select:
        "id, business_name, status, category, created_at, area, cover_photo, logo_url, gallery_photos, view_count, boost_until, featured_until, urgent_until, expires_at, status_reason",
      omittedFields: [] as const,
    },
    {
      select:
        "id, business_name, status, category, created_at, area, cover_photo, logo_url, gallery_photos, boost_until, featured_until, urgent_until, expires_at, status_reason",
      omittedFields: ["view_count"] as const,
    },
    {
      select:
        "id, business_name, status, category, created_at, area, cover_photo, logo_url, gallery_photos, view_count, boost_until, featured_until, urgent_until, status_reason",
      omittedFields: ["expires_at"] as const,
    },
    {
      select:
        "id, business_name, status, category, created_at, area, cover_photo, logo_url, gallery_photos, boost_until, featured_until, urgent_until, status_reason",
      omittedFields: ["view_count", "expires_at"] as const,
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
    queryWithSelectFallbacks({
      attempts: businessSelectAttempts,
      fallbackFields: BUSINESS_DASHBOARD_FALLBACK_FIELDS,
      runQuery: (selectClause) =>
        applyOwnerFilter(
          supabase
            .from("businesses")
            .select(selectClause)
            .order("created_at", { ascending: false }),
          businessOwnerColumn,
          user.id
        ),
    }),
    queryWithSelectFallbacks({
      attempts: [
        {
          select:
            "id, title, status, price_cents, category, created_at, published_at, photos, view_count, boost_until, featured_until, urgent_until, expires_at, start_date, end_date, status_reason, promotion_type",
          omittedFields: [] as const,
        },
        {
          select:
            "id, title, status, price_cents, category, created_at, published_at, photos, view_count, boost_until, featured_until, urgent_until, start_date, end_date, status_reason, promotion_type",
          omittedFields: ["expires_at"] as const,
        },
        {
          select:
            "id, title, status, price_cents, category, created_at, published_at, photos, view_count, boost_until, featured_until, expires_at, start_date, end_date, status_reason, promotion_type",
          omittedFields: ["urgent_until"] as const,
        },
        {
          select:
            "id, title, status, price_cents, category, created_at, published_at, photos, view_count, boost_until, featured_until, start_date, end_date, status_reason, promotion_type",
          omittedFields: ["urgent_until", "expires_at"] as const,
        },
      ] as const,
      fallbackFields: PROMOTION_DASHBOARD_FALLBACK_FIELDS,
      runQuery: (selectClause) =>
        applyOwnerFilter(
          supabase
            .from("promotions")
            .select(selectClause)
            .order("created_at", { ascending: false }),
          promotionOwnerColumn,
          user.id
        ),
    }),
  ]);

  const baseItems = [
    ...toDashboardItems(listingResponse.data).map((listing) => ({
      ...listing,
      source: "listing" as const,
      featured_until: listing.featured_until ?? null,
      urgent_until: listing.urgent_until ?? null,
      expires_at: listing.expires_at ?? null,
      view_count: listing.view_count ?? null,
    })),
    ...(Array.isArray(businessResponse.data)
      ? (businessResponse.data as unknown as BusinessDashboardRow[])
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
      expires_at: business.expires_at ?? null,
      price_cents: null,
      view_count: business.view_count ?? null,
      urgent_until: business.urgent_until ?? null,
    })),
    ...toDashboardItems(promotionResponse.data).map((promotion) => ({
      ...promotion,
      area: "PROMOTIONS_EVENTS" as const,
      source: "promotion" as const,
      photos: Array.isArray(promotion.photos) ? promotion.photos : [],
      expires_at:
        ((promotion as Record<string, unknown>).expires_at as string | null) ??
        ((promotion as Record<string, unknown>).end_date as string | null) ??
        null,
      urgent_until: ((promotion as Record<string, unknown>).urgent_until as string | null) ?? null,
      promotion_type:
        ((promotion as Record<string, unknown>).promotion_type as string | null) ?? null,
      start_date: ((promotion as Record<string, unknown>).start_date as string | null) ?? null,
      end_date: ((promotion as Record<string, unknown>).end_date as string | null) ?? null,
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

  const sponsoredIds = await loadSponsoredContentIds(engagementAdmin, user.id);
  const items = sortByNewest(
    baseItems
      .map((item) => ({
        ...item,
        view_count: getViewCountForItem(item, viewCounts),
        sponsored: sponsoredIds.has(item.id),
      }))
      .map((item) => applyDashboardExpiryStatus(item))
  );

  const active = items.filter((item) => item.status === "active" || item.status === "live");
  const pending = items.filter(
    (item) => item.status === "pending_review" || item.status === "pending_moderation"
  );
  const expired = items.filter(
    (item) =>
      item.status === "expired" ||
      item.status === "sold" ||
      (item.status === "hidden" && item.status_reason === OWNER_DEACTIVATED_REASON)
  );
  const rejected = items.filter((item) => item.status === "rejected");

  const byArea = (list: DashboardItem[]) =>
    areaFilter ? list.filter((item) => item.area === areaFilter) : list;

  const filteredActive = byArea(active);
  const filteredPending = byArea(pending);
  const filteredExpired = byArea(expired);
  const filteredRejected = byArea(rejected);

  const [mzansiTier, mzansiBusinessTier, promotionsTier] = await Promise.all([
    getActivePlanTierForArea(user.id, "MZANSI_MARKET"),
    getActivePlanTierForArea(user.id, "MZANSI_BUSINESS"),
    getActivePlanTierForArea(user.id, "PROMOTIONS_EVENTS"),
  ]);

  const planTiers: Record<MarketplaceArea, PlanTier> = {
    MZANSI_MARKET: mzansiTier,
    MZANSI_BUSINESS: mzansiBusinessTier,
    PROMOTIONS_EVENTS: promotionsTier,
  };

  const slotUsage = await loadSlotUsage(engagementAdmin, user.id);

  const hasAnyItems = items.length > 0;
  const areaLabel = areaFilter ? AREA_LABELS[areaFilter] : null;
  const inArea = areaLabel ? ` in ${areaLabel}` : "";

  return (
    <div className="min-w-0 max-w-full space-y-6">
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
        description="Edit, promote or take posts offline."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "My Posts" }]}
      >
        <Button
          asChild
          variant="trust-verified"
          className="h-11 w-full gap-2 rounded-full px-5 sm:w-auto"
        >
          <Link href="/post/create">
            <Plus aria-hidden="true" className="h-4 w-4" />
            New post
          </Link>
        </Button>
      </PageHeader>

      <SlotUsageCard entries={slotUsage} />

      <div className="space-y-4">
        <Suspense>
          <AreaFilter />
        </Suspense>

        <Tabs defaultValue="active" className="min-w-0 max-w-full">
          <div className="-mx-4 overflow-x-auto px-4 pb-1 scrollbar-hide sm:mx-0 sm:px-0">
            <TabsList className="h-auto w-max max-w-none rounded-2xl p-1">
              <TabsTrigger value="active" className="h-10 rounded-xl px-3.5">
                Live ({filteredActive.length})
              </TabsTrigger>
              <TabsTrigger value="pending" className="h-10 rounded-xl px-3.5">
                In review ({filteredPending.length})
              </TabsTrigger>
              <TabsTrigger value="rejected" className="h-10 rounded-xl px-3.5">
                Rejected ({filteredRejected.length})
              </TabsTrigger>
              <TabsTrigger value="expired" className="h-10 rounded-xl px-3.5">
                Ended ({filteredExpired.length})
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="active" className="mt-4">
            <ListingList
              listings={filteredActive}
              planTiers={planTiers}
              empty={
                hasAnyItems
                  ? {
                      title: `No live posts${inArea}`,
                      description: "Approved posts show here.",
                    }
                  : {
                      title: "You haven't posted yet",
                      description: "We check each post, then it goes live here.",
                      showCta: true,
                    }
              }
            />
          </TabsContent>
          <TabsContent value="pending" className="mt-4">
            <ListingList
              listings={filteredPending}
              planTiers={planTiers}
              empty={{
                title: `Nothing in review${inArea}`,
                description: "Posts waiting for a check show here.",
              }}
            />
          </TabsContent>
          <TabsContent value="rejected" className="mt-4">
            <RejectedListingList listings={filteredRejected} />
          </TabsContent>
          <TabsContent value="expired" className="mt-4">
            <ListingList
              listings={filteredExpired}
              planTiers={planTiers}
              empty={{
                title: `No ended posts${inArea}`,
                description: "Sold, expired and paused posts. Reactivate any time.",
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

const AREA_PILL_CLASSES: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "area-market-tile",
  MZANSI_BUSINESS: "area-business-tile",
  PROMOTIONS_EVENTS: "area-tourism-tile",
};

function AreaPill({ area }: { area: MarketplaceArea }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${AREA_PILL_CLASSES[area]}`}
    >
      {AREA_LABELS[area]}
    </span>
  );
}

function EmptyState({
  title,
  description,
  showCta = false,
  icon: Icon = Package,
}: {
  title: string;
  description: string;
  showCta?: boolean;
  icon?: React.ElementType;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/60 px-5 py-10 text-center">
      <span aria-hidden="true" className="empty-state-icon">
        <Icon className="h-6 w-6" />
      </span>
      <p className="mt-3 font-display text-base font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {showCta ? (
        <Button asChild variant="trust-verified" className="mt-4 h-11 gap-1.5 rounded-full px-5">
          <Link href="/post/create">
            <Plus aria-hidden="true" className="h-4 w-4" />
            Create your first post
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

function ItemMeta({ item }: { item: DashboardItem }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-muted-foreground">
      <AreaPill area={item.area} />
      {item.area === "PROMOTIONS_EVENTS" &&
        item.promotion_type &&
        PROMOTION_TYPE_LABELS[item.promotion_type as PromotionType] && (
          <Badge variant="secondary" className="text-[11px]">
            {PROMOTION_TYPE_LABELS[item.promotion_type as PromotionType]}
          </Badge>
        )}
      <span className="inline-flex items-center gap-1">
        <Eye aria-hidden="true" className="h-3.5 w-3.5" />
        <span>{item.view_count ?? 0}</span>
        <span>{getViewCountLabel(item.view_count)}</span>
      </span>
      <span>Posted {formatRelativeTime(item.created_at || new Date().toISOString())}</span>
    </div>
  );
}

function RejectedListingList({ listings }: { listings: DashboardItem[] }) {
  if (!listings.length) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="No rejected posts"
        description="Posts that need changes show here."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {listings.map((listing) => (
        <li key={listing.id}>
          <Card className="border-brand-red-300/70 dark:border-brand-red-500/30">
            <CardContent className="flex flex-col gap-4 p-4 sm:p-5">
              <div className="flex items-start gap-3 sm:gap-4">
                <Thumbnail item={listing} muted />

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 truncate text-sm font-semibold text-foreground sm:text-base">
                      {listing.title}
                    </h3>
                    <Badge variant="rejected" className="shrink-0 text-[11px]">
                      Rejected
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-sm font-semibold text-foreground/80">
                    {getDisplayPrice(listing)}
                  </p>
                  <ItemMeta item={listing} />
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-brand-red-200 bg-brand-red-50 p-3 dark:border-brand-red-500/30 dark:bg-brand-red-500/10">
                <XCircle
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-brand-red-700 dark:text-brand-red-300"
                />
                <div className="text-sm">
                  <p className="font-semibold text-brand-red-800 dark:text-brand-red-200">
                    Reason for rejection
                  </p>
                  <p className="mt-0.5 text-foreground/80">
                    {listing.status_reason ||
                      "This item was rejected. No specific reason was provided."}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Edit your content then resubmit for review.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button asChild variant="outline" size="sm" className="h-11 gap-1.5 px-4">
                    <Link href={getEditHref(listing)} aria-label={`Edit ${listing.title}`}>
                      <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                      Edit
                    </Link>
                  </Button>
                  <ResubmitButton itemId={listing.id} area={listing.area} />
                  <DeletePostButton itemId={listing.id} area={listing.area} />
                </div>
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function ListingList({
  listings,
  planTiers,
  empty,
}: {
  listings: DashboardItem[];
  planTiers: Record<MarketplaceArea, PlanTier>;
  empty: { title: string; description: string; showCta?: boolean };
}) {
  if (!listings.length) {
    return <EmptyState {...empty} />;
  }

  return (
    <ul className="space-y-3">
      {listings.map((listing) => {
        const isLive = listing.status === "active" || listing.status === "live";
        return (
          <li key={listing.id}>
            <Card>
              <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
                <div className="flex items-start gap-3 sm:gap-4">
                  <Thumbnail item={listing} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 truncate text-sm font-semibold text-foreground sm:text-base">
                        {listing.title}
                      </h3>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        <StatusBadges item={listing} />
                      </div>
                    </div>
                    <p className="mt-0.5 text-sm font-semibold text-brand-green-700 dark:text-brand-green-300">
                      {getDisplayPrice(listing)}
                    </p>
                    <ItemMeta item={listing} />
                    {shouldShowExpiryCountdown(listing) ? (
                      <ExpiryCountdownBadge
                        expiresAt={getPostExpiresAt(listing)}
                        showDate
                        className="mt-2 rounded-lg bg-brand-gold-50 px-2 py-1 text-xs font-medium text-brand-gold-900 ring-1 ring-inset ring-brand-gold-300/60 dark:bg-brand-gold-400/10 dark:text-brand-gold-200 dark:ring-brand-gold-400/25"
                      />
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
                  <Button asChild variant="outline" size="sm" className="h-11 gap-1.5 px-4">
                    <Link href={getEditHref(listing)}>
                      <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                      Edit
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm" className="h-11 gap-1.5 px-3">
                    <Link href={getViewHref(listing)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                      View
                      <span className="sr-only">(opens in a new tab)</span>
                    </Link>
                  </Button>
                  <LifecycleActions item={listing} />
                  {listing.source === "business" && isLive && (
                    <PostAccountButton
                      accountTitle={listing.title}
                      area="PROMOTIONS_EVENTS"
                      postHref={`/post/create-tourism?business_id=${listing.id}`}
                    />
                  )}

                  <div
                    role="group"
                    aria-label="Promote this post"
                    className="ml-auto flex items-center gap-0.5 rounded-full border border-border/70 bg-background/60 p-0.5"
                  >
                    <BoostButton
                      listingId={listing.id}
                      isBoosted={
                        listing.boost_until ? new Date(listing.boost_until) > new Date() : false
                      }
                      canBoost={
                        isLive && checkCanBoost(planTiers[listing.area], listing.area).allowed
                      }
                      itemTypeLabel={dashboardActionLabel(listing.source)}
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
                        listing.featured_until
                          ? new Date(listing.featured_until) > new Date()
                          : false
                      }
                      canFeature={
                        isLive && checkCanFeatured(planTiers[listing.area], listing.area).allowed
                      }
                      itemTypeLabel={dashboardActionLabel(listing.source)}
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
                        isLive && checkCanUrgent(planTiers[listing.area], listing.area).allowed
                      }
                      itemTypeLabel={dashboardActionLabel(listing.source)}
                      urgentApiPath={
                        listing.source === "business"
                          ? `/api/businesses/${listing.id}/urgent`
                          : listing.source === "promotion"
                            ? `/api/promotions/${listing.id}/urgent`
                            : undefined
                      }
                    />
                  </div>
                  <DeletePostButton itemId={listing.id} area={listing.area} />
                </div>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** Lifecycle, event stage and sponsorship labels (subscription state stays separate). */
function StatusBadges({ item }: { item: DashboardItem }) {
  const display = toDisplayContentStatus(item.status, item.status_reason);
  const isEvent = item.source === "promotion" && item.promotion_type === "event";
  const isLive = item.status === "active" || item.status === "live";
  return (
    <>
      {isEvent ? (
        <Badge variant="outline" className="text-[11px]">
          {EVENT_LIFECYCLE_LABELS[eventLifecycle(item)]}
        </Badge>
      ) : display === "PENDING_REVIEW" ? (
        <Badge variant="pending" className="text-[11px]">
          In review
        </Badge>
      ) : display !== "ACTIVE" ? (
        <Badge variant="draft" className="text-[11px]">
          {DISPLAY_STATUS_LABELS[display]}
        </Badge>
      ) : isLive ? (
        <Badge variant="live" className="text-[11px]">
          Live
        </Badge>
      ) : null}
      {item.sponsored ? (
        <Badge variant="secondary" className="text-[11px]">
          Sponsored
        </Badge>
      ) : null}
    </>
  );
}

/** Slot actions: free a slot (sold / deactivate) or reactivate saved content. */
function LifecycleActions({ item }: { item: DashboardItem }) {
  const isLive = item.status === "active" || item.status === "live";
  const isFreeEvent = item.source === "promotion" && item.promotion_type === "event";
  if (isLive) {
    return (
      <ContentLifecycleButton
        contentType={item.source}
        id={item.id}
        action={item.source === "listing" ? "mark_sold" : "deactivate"}
      />
    );
  }
  const canReactivate =
    !isFreeEvent &&
    (item.status === "expired" ||
      item.status === "sold" ||
      (item.status === "hidden" && item.status_reason === OWNER_DEACTIVATED_REASON));
  return canReactivate ? (
    <ContentLifecycleButton contentType={item.source} id={item.id} action="reactivate" />
  ) : null;
}

function Thumbnail({ item, muted = false }: { item: DashboardItem; muted?: boolean }) {
  return (
    <div
      className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-muted sm:h-[4.5rem] sm:w-[4.5rem] ${
        muted ? "opacity-60" : ""
      }`}
    >
      {item.photos?.[0] ? (
        <Image
          src={normalizeMediaUrl(item.photos[0])}
          alt={item.title || "Listing thumbnail"}
          width={72}
          height={72}
          className="h-full w-full bg-muted object-contain"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground/60">
          <Package aria-hidden="true" className="h-5 w-5" />
          <span className="sr-only">No photo</span>
        </div>
      )}
    </div>
  );
}
