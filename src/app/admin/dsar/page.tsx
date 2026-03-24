import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils/format";
import { maskEmail } from "@/lib/utils/mask";
import { Download, FileText } from "lucide-react";
import { DsarActionButtons } from "./dsar-action-buttons";
import { isAdmin } from "@/lib/auth/roles";
import type { DsarCase } from "@/types/database";

export const metadata = {
  title: "Data Requests — Admin",
  description: "Process POPIA data subject access and deletion requests.",
};

export default async function AdminDSARPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  // Read from dsar_cases table
  const { data: requests } = await admin
    .from("dsar_cases")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Requests"
        description="Manage POPIA data requests."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Data Requests" }]}
      />

      {!requests?.length ? (
        <div className="text-center py-6 text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-3" />
          <p>No data requests found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {}
          {requests.map((req: DsarCase) => (
            <Card key={req.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {req.type || "access"}
                      </Badge>
                      <Badge
                        variant={
                          req.status === "submitted"
                            ? "destructive"
                            : req.status === "completed"
                              ? "default"
                              : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {req.status}
                      </Badge>
                    </div>
                    <p className="text-sm">{maskEmail(req.requester_email)}</p>
                    {req.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {req.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(req.created_at)}
                    </p>
                  </div>
                  {(req.status === "submitted" || req.status === "in_progress") && (
                    <DsarActionButtons requestId={req.id} status={req.status} />
                  )}
                  <Button asChild variant="outline" size="sm" className="gap-2">
                    <a href={`/api/admin/dsar/export?requestId=${req.id}`}>
                      <Download className="h-4 w-4" />
                      <span>Export JSON</span>
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
