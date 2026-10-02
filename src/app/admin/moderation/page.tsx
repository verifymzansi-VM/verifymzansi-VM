import { requireStaff } from "@/lib/auth/require-staff";
import { roleHasCapability } from "@/lib/auth/admin-access";
import { countMyClaims, getClaimsForItems, getMyClaimedItems } from "@/lib/services/queue-claims";
import { QueueClaimBar, QueueClaimsProvider } from "@/components/admin/queue-claims";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { ModerationQueueClient } from "@/components/admin/moderation/moderation-queue-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { toContentEditModerationItem } from "@/lib/content-edit-moderation";
import {
  BUSINESS_FIELDS,
  claimTypeOf,
  EDIT_FIELDS,
  LISTING_FIELDS,
  PROMOTION_FIELDS,
  businessItem,
  listingItem,
  oldestFirst,
  promotionItem,
} from "@/lib/admin/moderation-items";

const log = createLogger("AdminModerationPage");

export const metadata = {
  title: "Content moderation — Admin",
  description: "Review and moderate flagged content, listings, and user reports.",
};

const SHOWN_PER_TYPE = 50;

type Read<T> = { data: T[] | null; error: { message: string } | null; count?: number | null };

/**
 * Join the oldest waiting rows with the rows the viewer holds (which may lie
 * beyond the limit), keeping the true total from the first read.
 */
function withClaimed<T extends { id: string }>(oldest: Read<T>, claimed: Read<T>): Read<T> {
  if (oldest.error || claimed.error) {
    return { data: null, error: oldest.error ?? claimed.error, count: null };
  }
  const byId = new Map<string, T>();
  for (const row of [...(oldest.data ?? []), ...(claimed.data ?? [])]) byId.set(row.id, row);
  return { data: [...byId.values()], error: null, count: oldest.count ?? null };
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export default async function AdminModerationPage() {
  const { user, role } = await requireStaff("queue:view");

  const admin = createAdminClient();

  // The oldest waiting items of each kind with their true totals, plus the
  // items the viewer holds, even beyond the limit.
  const myClaimed = await getMyClaimedItems(user.id, "content");
  const mine = (type: string) => myClaimed.filter((c) => c.type === type).map((c) => c.id);
  /** No extra query when the viewer holds nothing of this kind. */
  const NONE = Promise.resolve({ data: [] as never[], error: null });
  const [
    listingsOldest,
    businessesOldest,
    promotionsOldest,
    editsOldest,
    listingsMine,
    businessesMine,
    promotionsMine,
    editsMine,
  ] = await Promise.all([
    admin
      .from("listings")
      .select(LISTING_FIELDS, { count: "exact" })
      .eq("status", "pending_moderation")
      .order("created_at", { ascending: true })
      .limit(SHOWN_PER_TYPE),
    admin
      .from("businesses")
      .select(BUSINESS_FIELDS, { count: "exact" })
      .eq("status", "pending_moderation")
      .order("created_at", { ascending: true })
      .limit(SHOWN_PER_TYPE),
    admin
      .from("promotions")
      .select(PROMOTION_FIELDS, { count: "exact" })
      .eq("status", "pending_moderation")
      .order("created_at", { ascending: true })
      .limit(SHOWN_PER_TYPE),
    admin
      .from("content_edit_requests")
      .select(EDIT_FIELDS, { count: "exact" })
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(SHOWN_PER_TYPE),
    mine("listing").length
      ? admin
          .from("listings")
          .select(LISTING_FIELDS)
          .eq("status", "pending_moderation")
          .in("id", mine("listing"))
      : NONE,
    mine("business").length
      ? admin
          .from("businesses")
          .select(BUSINESS_FIELDS)
          .eq("status", "pending_moderation")
          .in("id", mine("business"))
      : NONE,
    mine("promotion").length
      ? admin
          .from("promotions")
          .select(PROMOTION_FIELDS)
          .eq("status", "pending_moderation")
          .in("id", mine("promotion"))
      : NONE,
    mine("content_edit").length
      ? admin
          .from("content_edit_requests")
          .select(EDIT_FIELDS)
          .eq("status", "pending")
          .in("id", mine("content_edit"))
      : NONE,
  ]);
  const listingsResult = withClaimed(listingsOldest, listingsMine);
  const businessesResult = withClaimed(businessesOldest, businessesMine);
  const promotionsResult = withClaimed(promotionsOldest, promotionsMine);
  const editRequestsResult = withClaimed(editsOldest, editsMine);
  const totalWaiting = [listingsResult, businessesResult, promotionsResult, editRequestsResult]
    .map((r) => r.count ?? r.data?.length ?? 0)
    .reduce((a, b) => a + b, 0);

  const pendingListings = listingsResult.data ?? [];
  const pendingBusinesses = businessesResult.data ?? [];
  const pendingPromotions = promotionsResult.data ?? [];
  const pendingEditRequests = editRequestsResult.data ?? [];
  const failedAreas = [
    listingsResult.error ? "Mzansi Market" : null,
    businessesResult.error ? "Mzansi Business" : null,
    promotionsResult.error ? "Tourism & Events" : null,
    editRequestsResult.error ? "Pending edits" : null,
  ].filter((value): value is string => Boolean(value));

  if (failedAreas.length > 0) {
    log.error("Failed to load some moderation queues", {
      failedAreas,
      listingsError: listingsResult.error?.message,
      businessesError: businessesResult.error?.message,
      promotionsError: promotionsResult.error?.message,
      editRequestsError: editRequestsResult.error?.message,
    });
  }

  const editItems = pendingEditRequests.map(toContentEditModerationItem);

  // Duplicate-detection context for the advisory quality check: the owner's
  // other recent listings (titles and photos). Best effort.
  const ownerIds = [...new Set(pendingListings.map((l) => l.owner_id).filter(Boolean))];
  const ownerContext = new Map<string, Array<{ id: string; title: string; photos: string[] }>>();
  if (ownerIds.length > 0) {
    try {
      const { data: recent } = await admin
        .from("listings")
        .select("id, owner_id, title, photos")
        .in("owner_id", ownerIds)
        .gte("created_at", daysAgoIso(30))
        .limit(500);
      for (const row of (recent ?? []) as Array<{
        id: string;
        owner_id: string;
        title: string;
        photos: string[] | null;
      }>) {
        const list = ownerContext.get(row.owner_id) ?? [];
        list.push({ id: row.id, title: row.title, photos: row.photos ?? [] });
        ownerContext.set(row.owner_id, list);
      }
    } catch {
      // Quality hints are advisory.
    }
  }
  const qualityContext = (id: string, ownerId: string | null | undefined) => {
    const others = (ownerId ? (ownerContext.get(ownerId) ?? []) : []).filter((o) => o.id !== id);
    return {
      owner_recent_titles: others.map((o) => o.title),
      owner_photo_urls: others.flatMap((o) => o.photos),
    };
  };

  const allItems = oldestFirst([
    ...pendingListings.map((l) => ({ ...listingItem(l), ...qualityContext(l.id, l.owner_id) })),
    ...pendingBusinesses.map(businessItem),
    ...pendingPromotions.map(promotionItem),
    ...editItems,
  ]);

  const shownCount = allItems.length;
  const [claims, myClaims] = await Promise.all([
    getClaimsForItems(
      user.id,
      allItems.map((item) => ({ type: claimTypeOf(item), id: item.id }))
    ),
    countMyClaims(user.id, "content"),
  ]);

  return (
    <div className="min-w-0 w-full max-w-full space-y-6 overflow-x-hidden">
      <PageHeader
        title="Content moderation"
        description="Review and approve pending content."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Moderation" }]}
      >
        <Badge variant="outline" className="gap-1">
          {totalWaiting} pending
        </Badge>
      </PageHeader>

      {failedAreas.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Some moderation items could not be loaded for: {failedAreas.join(", ")}.
        </div>
      )}

      {totalWaiting > shownCount && (
        <p className="text-sm text-muted-foreground">
          Showing {shownCount} of {totalWaiting} waiting items: the oldest {SHOWN_PER_TYPE} of each
          kind, plus any you hold. Claiming always takes the oldest first, including those not
          shown.
        </p>
      )}

      <QueueClaimBar
        queue="content"
        myClaims={myClaims}
        canClaim={roleHasCapability(role, "queue:claim")}
      />

      <QueueClaimsProvider
        claims={claims}
        mustClaim={role === "moderator"}
        canFree={roleHasCapability(role, "decision:approve")}
      >
        <ModerationQueueClient items={allItems} />
      </QueueClaimsProvider>
    </div>
  );
}
