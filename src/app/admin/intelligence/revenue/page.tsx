import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasCapability } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, DollarSign, CreditCard, ArrowUpRight } from "lucide-react";

export const metadata = {
  title: "Revenue & Costs — Intelligence",
  description: "Financial overview and transaction analytics.",
};

export default async function IntelligenceRevenuePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !hasCapability(user, "bi:view")) {
    redirect("/admin");
  }

  const admin = createAdminClient();

  // Fetch payment data
  const [{ count: totalTransactions }, { data: completedPayments }, { count: failedTransactions }] =
    await Promise.all([
      admin.from("payments").select("*", { count: "exact", head: true }),
      admin.from("payments").select("amount_cents").eq("status", "completed"),
      admin.from("payments").select("*", { count: "exact", head: true }).eq("status", "failed"),
    ]);

  const total = totalTransactions ?? 0;
  const failed = failedTransactions ?? 0;
  const totalRevenue =
    completedPayments?.reduce(
      (sum, payment) => sum + (Number((payment as { amount_cents?: unknown }).amount_cents) || 0),
      0
    ) ?? 0;
  const successRate = total > 0 ? Math.round(((total - failed) / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revenue & Costs"
        description="Financial analytics and transaction tracking."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Revenue & Costs" }]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R {(totalRevenue / 100).toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Transactions</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{successRate}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <TrendingUp className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{failed}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
