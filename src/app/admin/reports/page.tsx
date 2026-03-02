import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Flag } from "lucide-react";
import { ReportsClient } from "./reports-client";
import { countOpenReports } from "@/lib/utils/reports";
import type { Report } from "@/types/database";
import { isModeratorOrAdmin } from "@/lib/auth/roles";

export const metadata = {
  title: "Reports | Admin | VerifyMzansi",
};

export default async function AdminReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isModeratorOrAdmin(user)) {
    redirect("/dashboard");
  }

  const { data: reports } = await supabase
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  const reportsData: Report[] = Array.isArray(reports) ? (reports as Report[]) : [];
  const openCount = countOpenReports(reportsData);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Review and resolve user reports across all areas."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Reports" }]}
      >
        <Badge variant="outline" className="gap-1">
          {openCount} Open
        </Badge>
      </PageHeader>

      {!reportsData.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <Flag className="h-10 w-10 mx-auto mb-3" />
          <p>No reports to review.</p>
        </div>
      ) : (
        <ReportsClient reports={reportsData} />
      )}
    </div>
  );
}
