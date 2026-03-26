import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasCapability } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, Clock, CheckCircle, XCircle } from "lucide-react";

export const metadata = {
  title: "Verification Metrics — Intelligence",
  description: "Identity verification pipeline analytics.",
};

export default async function IntelligenceVerificationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !hasCapability(user, "bi:view")) {
    redirect("/admin");
  }

  const admin = createAdminClient();

  const [
    { count: totalAttempts },
    { count: pendingCount },
    { count: approvedCount },
    { count: rejectedCount },
  ] = await Promise.all([
    admin.from("verification_steps").select("*", { count: "exact", head: true }),
    admin
      .from("verification_steps")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("verification_steps")
      .select("*", { count: "exact", head: true })
      .eq("status", "approved"),
    admin
      .from("verification_steps")
      .select("*", { count: "exact", head: true })
      .eq("status", "rejected"),
  ]);

  const total = totalAttempts ?? 0;
  const pending = pendingCount ?? 0;
  const approved = approvedCount ?? 0;
  const rejected = rejectedCount ?? 0;
  const passRate = total > 0 ? Math.round((approved / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verification Metrics"
        description="Identity verification pipeline performance."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Verification Metrics" }]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Verification Steps</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approved</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{approved}</div>
            <p className="text-xs text-muted-foreground">{passRate}% pass rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rejected</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rejected}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
