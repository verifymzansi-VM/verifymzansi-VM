import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Briefcase, Plus, Eye, Edit, XCircle } from "lucide-react";
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
  title: "My Business Profiles | VerifyMzansi",
};

export default async function BusinessProfilesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const planTier = await getActivePlanTierForArea(user.id, "BUSINESS_ADS");

  const { data: businesses } = await supabase
    .from("business_profiles")
    .select("*")
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Business Profiles"
        description="Manage your Business Ads profiles."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Business Profiles" }]}
      >
        <Button asChild size="sm" className="gap-1">
          <Link href="/post/create-business-ad">
            <Plus className="h-4 w-4" />
            New Profile
          </Link>
        </Button>
      </PageHeader>

      {!businesses || businesses.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center space-y-4">
            <Briefcase className="h-10 w-10 text-muted-foreground mx-auto" />
            <h3 className="font-display text-lg font-semibold">No business profiles yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Create a Business Ad to advertise your services with a professional profile, service
              areas, and contact details.
            </p>
            <Button asChild className="gap-1">
              <Link href="/post/create-business-ad">
                <Plus className="h-4 w-4" />
                Create Business Profile
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {businesses.map((biz) => (
            <Card key={biz.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{biz.business_name}</CardTitle>
                  <Badge variant={biz.status === "active" ? "default" : "secondary"}>
                    {biz.status}
                  </Badge>
                </div>
                {biz.tagline && <p className="text-sm text-muted-foreground">{biz.tagline}</p>}
              </CardHeader>
              <CardContent className="pt-0">
                {biz.status === "rejected" && (
                  <div className="flex items-start gap-2 p-3 mb-3 rounded-md bg-destructive/10 border border-destructive/20">
                    <XCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium text-destructive">Rejected</p>
                      <p className="text-muted-foreground mt-0.5">
                        {biz.status_reason || "No specific reason was provided."}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <BoostButton
                    listingId={biz.id}
                    isBoosted={biz.boost_until ? new Date(biz.boost_until) > new Date() : false}
                    canBoost={
                      biz.status === "live" && checkCanBoost(planTier, "BUSINESS_ADS").allowed
                    }
                    boostApiPath={`/api/business-ads/${biz.id}/boost`}
                  />
                  <CreatePostButton
                    entityId={biz.id}
                    entityType="business"
                    isLive={biz.status === "live" || biz.status === "active"}
                  />
                  {biz.status === "live" && (
                    <Button asChild variant="outline" size="sm" className="gap-1">
                      <Link href={`/business-ads/${biz.id}`}>
                        <Eye className="h-3 w-3" />
                        View
                      </Link>
                    </Button>
                  )}
                  <Button asChild variant="outline" size="sm" className="gap-1">
                    <Link href={`/post/edit-business-ad/${biz.id}`}>
                      <Edit className="h-3 w-3" />
                      Edit
                    </Link>
                  </Button>
                  {biz.status === "rejected" && (
                    <ResubmitButton itemId={biz.id} area="BUSINESS_ADS" />
                  )}
                  {biz.status === "rejected" && (
                    <DeletePostButton itemId={biz.id} area="BUSINESS_ADS" />
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
