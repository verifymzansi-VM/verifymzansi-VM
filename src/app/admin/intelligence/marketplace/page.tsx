import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasCapability } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingBag, Package, Store, TrendingUp } from "lucide-react";

export const metadata = {
  title: "Marketplace Health — Intelligence",
  description: "Marketplace listing and activity analytics.",
};

export default async function IntelligenceMarketplacePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !hasCapability(user, "bi:view")) {
    redirect("/admin");
  }

  const admin = createAdminClient();

  const [
    { count: totalListings },
    { count: liveListings },
    { count: totalBusinesses },
    { count: livePromotions },
  ] = await Promise.all([
    admin.from("listings").select("*", { count: "exact", head: true }),
    admin.from("listings").select("*", { count: "exact", head: true }).eq("status", "live"),
    admin.from("businesses").select("*", { count: "exact", head: true }),
    admin.from("promotions").select("*", { count: "exact", head: true }).eq("status", "live"),
  ]);

  const listings = totalListings ?? 0;
  const live = liveListings ?? 0;
  const businesses = totalBusinesses ?? 0;
  const promotions = livePromotions ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketplace Health"
        description="Marketplace ecosystem activity and health metrics."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Marketplace Health" }]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Listings</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{listings}</div>
            <p className="text-xs text-muted-foreground">{live} live</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Live Listings</CardTitle>
            <ShoppingBag className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{live}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Businesses</CardTitle>
            <Store className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{businesses}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Live Promotions</CardTitle>
            <TrendingUp className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{promotions}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
