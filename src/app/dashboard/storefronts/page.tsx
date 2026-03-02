import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Store, Plus, Eye, Edit, XCircle } from "lucide-react";
import { ResubmitButton } from "@/components/listings/resubmit-button";
import { DeletePostButton } from "@/components/listings/delete-post-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { BoostButton } from "@/components/listings/boost-button";
import { CreatePostButton } from "@/components/listings/create-post-button";
import { canBoost as checkCanBoost } from "@/lib/services/entitlements";
import { getActivePlanTierForArea } from "@/lib/services/plan-tier";

export const metadata = {
  title: "My Storefronts | VerifyMzansi",
};

export default async function StorefrontsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const planTier = await getActivePlanTierForArea(user.id, "MALL_SHOPS");

  const { data: storefronts } = await supabase
    .from("storefronts")
    .select("*")
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Storefronts"
        description="Manage your Mall Shop storefronts."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Storefronts" }]}
      >
        <Button asChild size="sm" className="gap-1">
          <Link href="/post/create-mall-shop">
            <Plus className="h-4 w-4" />
            New Shop
          </Link>
        </Button>
      </PageHeader>

      {!storefronts || storefronts.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center space-y-4">
            <Store className="h-10 w-10 text-muted-foreground mx-auto" />
            <h3 className="font-display text-lg font-semibold">No storefronts yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Create your first Mall Shop storefront to showcase products with custom branding and
              regular posts.
            </p>
            <Button asChild className="gap-1">
              <Link href="/post/create-mall-shop">
                <Plus className="h-4 w-4" />
                Create Storefront
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {storefronts.map((shop) => (
            <Card key={shop.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{shop.mall_name}</CardTitle>
                  <Badge variant={shop.status === "live" ? "default" : "secondary"}>
                    {shop.status}
                  </Badge>
                </div>
                {shop.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{shop.description}</p>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                {shop.status === "rejected" && (
                  <div className="flex items-start gap-2 p-3 mb-3 rounded-md bg-destructive/10 border border-destructive/20">
                    <XCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium text-destructive">Rejected</p>
                      <p className="text-muted-foreground mt-0.5">
                        {shop.status_reason || "No specific reason was provided."}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <BoostButton
                    listingId={shop.id}
                    isBoosted={shop.boost_until ? new Date(shop.boost_until) > new Date() : false}
                    canBoost={
                      shop.status === "live" && checkCanBoost(planTier, "MALL_SHOPS").allowed
                    }
                    boostApiPath={`/api/storefronts/${shop.id}/boost`}
                  />
                  <CreatePostButton
                    entityId={shop.id}
                    entityType="storefront"
                    isLive={shop.status === "live"}
                  />
                  {shop.status === "live" && (
                    <Button asChild variant="outline" size="sm" className="gap-1">
                      <Link href={`/mall-shop/${shop.id}`}>
                        <Eye className="h-3 w-3" />
                        View
                      </Link>
                    </Button>
                  )}
                  <Button asChild variant="outline" size="sm" className="gap-1">
                    <Link href={`/post/edit-mall-shop/${shop.id}`}>
                      <Edit className="h-3 w-3" />
                      Edit
                    </Link>
                  </Button>
                  {shop.status === "rejected" && (
                    <ResubmitButton itemId={shop.id} area="MALL_SHOPS" />
                  )}
                  {shop.status === "rejected" && (
                    <DeletePostButton itemId={shop.id} area="MALL_SHOPS" />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
