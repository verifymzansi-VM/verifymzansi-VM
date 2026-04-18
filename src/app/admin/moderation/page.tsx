import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { ModerationQueueClient } from "./moderation-queue-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStaff } from "@/lib/auth/roles";
import { createLogger } from "@/lib/utils/logger";

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
  const [listingsResult, businessesResult, promotionsResult] = await Promise.all([
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
  ]);

  const pendingListings = listingsResult.data ?? [];
  const pendingBusinesses = businessesResult.data ?? [];
  const pendingPromotions = promotionsResult.data ?? [];
  const failedAreas = [
    listingsResult.error ? "Mzansi Market" : null,
    businessesResult.error ? "Mzansi Business" : null,
    promotionsResult.error ? "Tourism & Events" : null,
  ].filter((value): value is string => Boolean(value));

  if (failedAreas.length > 0) {
    log.error("Failed to load some moderation queues", {
      failedAreas,
      listingsError: listingsResult.error?.message,
      businessesError: businessesResult.error?.message,
      promotionsError: promotionsResult.error?.message,
    });
  }

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
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const totalPending = allItems.length;

  return (
    <div className="space-y-6">
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
