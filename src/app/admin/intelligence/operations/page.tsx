import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasCapability } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Flag, ShieldCheck, Activity } from "lucide-react";

export const metadata = {
  title: "Ops Summary — Intelligence",
  description: "Read-only operational summary for admin review.",
};

export default async function IntelligenceOperationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !hasCapability(user, "bi:view")) {
    redirect("/admin");
  }

  const admin = createAdminClient();

  const [
    { count: openReports },
    { count: pendingVerifications },
    { count: pendingListingModeration },
    { count: pendingBusinessModeration },
    { count: pendingPromotionModeration },
    { count: pendingDecisions },
  ] = await Promise.all([
    admin.from("reports").select("*", { count: "exact", head: true }).eq("status", "open"),
    admin
      .from("verification_steps")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_moderation"),
    admin
      .from("businesses")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_moderation"),
    admin
      .from("promotions")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_moderation"),
    admin
      .from("decision_records")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_approval"),
  ]);

  const reports = openReports ?? 0;
  const verifications = pendingVerifications ?? 0;
  const moderation =
    (pendingListingModeration ?? 0) +
    (pendingBusinessModeration ?? 0) +
    (pendingPromotionModeration ?? 0);
  const decisions = pendingDecisions ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ops Summary"
        description="Read-only operational overview — current queue depths and workload."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Ops Summary" }]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Reports</CardTitle>
            <Flag className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{reports}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Verifications</CardTitle>
            <ShieldCheck className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{verifications}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Moderation</CardTitle>
            <Clock className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{moderation}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Decisions</CardTitle>
            <Activity className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{decisions}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
