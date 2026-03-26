import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasCapability } from "@/lib/auth/roles";
import { getPendingAppeals } from "@/lib/services/decision-ledger";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Scale } from "lucide-react";
import Link from "next/link";

export const metadata = {
  title: "Appeals — Governance",
  description: "Review and decide on submitted appeals.",
};

export default async function GovernanceAppealsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !hasCapability(user, "appeal:decide")) {
    redirect("/admin");
  }

  const appeals = await getPendingAppeals(50);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appeals"
        description="Review appeals against finalized decisions."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Appeals" }]}
      >
        <Badge variant="outline">{appeals.length} pending</Badge>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Appeals Queue</CardTitle>
        </CardHeader>
        <CardContent>
          {appeals.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              No appeals awaiting review.
            </p>
          ) : (
            <div className="space-y-2">
              {appeals.map((appeal) => (
                <Link
                  key={appeal.id}
                  href={`/admin/governance/appeals/${appeal.id}`}
                  className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Scale className="h-4 w-4 text-purple-500" />
                    <div>
                      <p className="text-sm font-medium">Appeal #{appeal.id.slice(0, 8)}</p>
                      <p className="text-xs text-muted-foreground">
                        Submitted {new Date(appeal.created_at).toLocaleDateString()}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-1">{appeal.reason}</p>
                    </div>
                  </div>
                  <Badge variant={appeal.status === "under_review" ? "secondary" : "outline"}>
                    {appeal.status.replace(/_/g, " ")}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
