import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { ModerationQueueClient } from "./moderation-queue-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStaff } from "@/lib/auth/roles";
import { createLogger } from "@/lib/utils/logger";
import { getContentEditChanges } from "@/lib/content-edit-diff";

const log = createLogger("AdminModerationPage");

export const metadata = {
  title: "Moderation Queue — Admin",
  description: "Review and moderate flagged content, listings, and user reports.",
};

export default async function AdminModerationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isStaff(user)) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  // Fetch all content pending moderation across all areas
  const [listingsResult, businessesResult, promotionsResult, editRequestsResult] =
    await Promise.all([
      admin
        .from("listings")
        .select(
          "id, title, status, created_at, category, owner_id, description, photos, videos, video_thumbnail, price_cents, price_negotiable, location_province, location_city, location_suburb, attributes, contact_methods, buyer_verification_required"
        )
        .eq("status", "pending_moderation")
        .order("created_at", { ascending: true })
        .limit(50),
      admin
        .from("businesses")
        .select(
          "id, business_name, business_type, status, created_at, owner_id, description, category, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province, location_city, store_number, map_directions, phone, whatsapp, email, website, social_links, operating_hours, services_offered, payment_methods_accepted, delivery_options, service_areas, business_details"
        )
        .eq("status", "pending_moderation")
        .order("created_at", { ascending: true })
        .limit(50),
      admin
        .from("promotions")
        .select(
          "id, title, status, created_at, category, owner_id, description, photos, videos, video_thumbnail, logo_url, price_cents, price_negotiable, location_province, location_city, contact_methods, promotion_type"
        )
        .eq("status", "pending_moderation")
        .order("created_at", { ascending: true })
        .limit(50),
      admin
        .from("content_edit_requests")
        .select(
          "id, target_type, target_id, owner_id, area, status, proposed_data, current_snapshot, created_at"
        )
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(50),
    ]);

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

  const editItems = pendingEditRequests.map((request) => {
    const proposed = (request.proposed_data ?? {}) as Record<string, unknown>;
    const currentSnapshot = (request.current_snapshot ?? {}) as Record<string, unknown>;
    const targetType = request.target_type as string;
    const title =
      typeof proposed.title === "string"
        ? proposed.title
        : typeof proposed.business_name === "string"
          ? proposed.business_name
          : typeof currentSnapshot.title === "string"
            ? currentSnapshot.title
            : typeof currentSnapshot.business_name === "string"
              ? currentSnapshot.business_name
              : `Edit ${String(request.id).slice(0, 8)}`;
    const area = request.area as "MZANSI_MARKET" | "MZANSI_BUSINESS" | "PROMOTIONS_EVENTS";
    const areaLabel =
      area === "MZANSI_MARKET"
        ? "Mzansi Market"
        : area === "MZANSI_BUSINESS"
          ? "Mzansi Business"
          : "Tourism & Events";
    const itemType =
      targetType === "business"
        ? "Business edit"
        : targetType === "promotion"
          ? "Promotion edit"
          : "Listing edit";

    return {
      ...proposed,
      id: request.id,
      targetId: request.target_id,
      title,
      status: request.status,
      created_at: request.created_at,
      owner_id: request.owner_id,
      area,
      areaLabel,
      itemType,
      isEditRequest: true,
      current_snapshot: currentSnapshot,
      change_summary: getContentEditChanges(currentSnapshot, proposed),
    };
  });

  const allItems = [
    ...(pendingListings || []).map((l) => ({
      ...l,
      area: "MZANSI_MARKET" as const,
      areaLabel: "Mzansi Market",
      itemType: "Listing",
    })),
    ...(pendingBusinesses || []).map((b) => ({
      ...b,
      title: b.business_name,
      area: "MZANSI_BUSINESS" as const,
      areaLabel: "Mzansi Business",
      itemType: "Business",
    })),
    ...(pendingPromotions || []).map((p) => ({
      ...p,
      area: "PROMOTIONS_EVENTS" as const,
      areaLabel: "Tourism & Events",
      itemType: "Promotion",
    })),
    ...editItems,
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const totalPending = allItems.length;

  return (
    <div className="min-w-0 w-full max-w-full space-y-6 overflow-x-hidden">
      <PageHeader
        title="Moderation Queue"
        description="Review and approve pending content."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Moderation" }]}
      >
        <Badge variant="outline" className="gap-1">
          {totalPending} Pending
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

      <ModerationQueueClient items={allItems} />
    </div>
  );
}
