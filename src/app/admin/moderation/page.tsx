import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { ModerationQueueClient } from "./moderation-queue-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { isModeratorOrAdmin } from "@/lib/auth/roles";

export const metadata = {
  title: "Moderation Queue | Admin | VerifyMzansi",
};

export default async function AdminModerationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isModeratorOrAdmin(user)) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  // Fetch all content pending moderation across all areas
  const [{ data: pendingListings }, { data: pendingBusinesses }] =
    await Promise.all([
      admin
        .from("listings")
        .select(
          "id, title, status, created_at, category, seller_id, description, photos, videos, price_cents, price_negotiable, location_province, location_city, location_suburb, attributes, contact_methods, buyer_verification_required"
        )
        .eq("status", "pending_moderation")
        .order("created_at", { ascending: true })
        .limit(50),
      admin
        .from("businesses")
        .select("id, business_name, business_type, status, created_at, seller_id")
        .eq("status", "pending_moderation")
        .order("created_at", { ascending: true })
        .limit(50),
    ]);

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
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const totalPending = allItems.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Moderation Queue"
        description="Review and approve content pending moderation across all areas."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Moderation" }]}
      >
        <Badge variant="outline" className="gap-1">
          {totalPending} Pending
        </Badge>
      </PageHeader>

      <ModerationQueueClient items={allItems} />
    </div>
  );
}
