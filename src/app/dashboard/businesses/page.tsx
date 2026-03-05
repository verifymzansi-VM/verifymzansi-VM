import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Building2, Plus, Pencil, Eye, Megaphone, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { timeAgo, expiresIn } from "@/lib/utils/format";
import {
  BUSINESS_TYPE_LABELS,
  BUSINESS_CATEGORY_LABELS,
  type BusinessType,
  type BusinessCategory,
} from "@/types/enums";

export const metadata = {
  title: "My Businesses",
  description: "Manage your registered businesses on VerifyMzansi.",
};

interface DashboardBusiness {
  id: string;
  business_name: string;
  business_type: string;
  category: string;
  status: string;
  boost_until: string | null;
  featured_until: string | null;
  created_at: string;
}

export default async function MyBusinessesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: businesses } = await admin
    .from("businesses")
    .select(
      "id, business_name, business_type, category, status, boost_until, featured_until, created_at"
    )
    .eq("seller_id", user.id)
    .in("status", ["live", "pending_moderation", "draft", "rejected"])
    .order("created_at", { ascending: false })
    .limit(50);

  const myBusinesses = (businesses ?? []) as unknown as DashboardBusiness[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Businesses"
        description="Manage your Mzansi Business listings."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Businesses" }]}
      >
        <Button asChild size="sm" className="gap-1">
          <Link href="/post/create-business">
            <Plus className="h-4 w-4" />
            Create Business
          </Link>
        </Button>
      </PageHeader>

      {myBusinesses.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <Building2 className="h-8 w-8 text-muted-foreground mx-auto" />
            <h2 className="font-display text-lg font-semibold">No businesses yet</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Create your first business to showcase your brand and link promotions.
            </p>
            <Button asChild size="sm">
              <Link href="/post/create-business">Create Business</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {myBusinesses.map((b) => {
            const now = new Date();
            const isBoosted = b.boost_until && new Date(b.boost_until) > now;
            const isFeatured = b.featured_until && new Date(b.featured_until) > now;

            return (
              <Card key={b.id}>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/mzansi-business/${b.id}`}
                        className="font-medium text-sm hover:text-brand-blue transition-colors line-clamp-1"
                      >
                        {b.business_name}
                      </Link>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>
                          {BUSINESS_TYPE_LABELS[b.business_type as BusinessType] || b.business_type}
                        </span>
                        <span>&middot;</span>
                        <span>
                          {BUSINESS_CATEGORY_LABELS[b.category as BusinessCategory] || b.category}
                        </span>
                        <span>&middot;</span>
                        <span>{timeAgo(b.created_at)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {b.status === "pending_moderation" && (
                        <Badge variant="secondary">Pending</Badge>
                      )}
                      {b.status === "draft" && <Badge variant="outline">Draft</Badge>}
                      {b.status === "rejected" && <Badge variant="destructive">Rejected</Badge>}
                      {b.status === "live" && (
                        <Badge className="bg-brand-green text-white">Live</Badge>
                      )}
                      {isBoosted && (
                        <Badge variant="outline" className="text-orange-600">
                          Boosted
                        </Badge>
                      )}
                      {isFeatured && (
                        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                          Featured
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Boost / Featured expiry */}
                  {(isBoosted || isFeatured) && (
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      {isBoosted && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Boost {expiresIn(b.boost_until!)}
                        </span>
                      )}
                      {isFeatured && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Featured {expiresIn(b.featured_until!)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <Button asChild size="sm" variant="outline" className="h-8 gap-1">
                      <Link href={`/mzansi-business/${b.id}`}>
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="h-8 gap-1">
                      <Link href={`/post/edit-business/${b.id}`}>
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Link>
                    </Button>
                    {b.status === "live" && (
                      <Button asChild size="sm" variant="ghost" className="h-8 gap-1">
                        <Link href={`/post/create-promotion?business_id=${b.id}`}>
                          <Megaphone className="h-3.5 w-3.5" />
                          Promote
                        </Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
