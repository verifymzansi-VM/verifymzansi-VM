import { requireStaff } from "@/lib/auth/require-staff";
import { roleHasCapability } from "@/lib/auth/admin-access";
import { readReportsPage } from "@/lib/services/report-page";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { QueueClaimBar, QueueClaimsProvider } from "@/components/admin/queue-claims";
import { Flag } from "lucide-react";
import { ReportsClient } from "./reports-client";

export const metadata = {
  title: "Reports — Admin",
  description: "Review user-submitted reports on marketplace posts.",
};

export default async function AdminReportsPage() {
  const { user, role } = await requireStaff("queue:view");
  const {
    reports: reportsData,
    open,
    openTotal,
    myClaims,
    claims,
    error,
  } = await readReportsPage(user.id);
  if (error) {
    return (
      <p role="alert">
        Reports could not be loaded. Refresh to try again. This does not mean there are no reports.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Claim reports to work on them. High-severity reports come first."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Reports" }]}
      >
        <Badge variant="outline" className="gap-1">
          {openTotal} open
        </Badge>
      </PageHeader>

      <QueueClaimBar
        queue="reports"
        myClaims={myClaims}
        canClaim={roleHasCapability(role, "queue:claim")}
      />

      {openTotal > open.length && (
        <p className="text-sm text-muted-foreground">
          Showing the first {open.length} of {openTotal} open reports. Claiming always takes the
          most urgent ones, including those not shown.
        </p>
      )}

      {!reportsData.length ? (
        <div className="text-center py-6 text-muted-foreground">
          <Flag className="h-8 w-8 mx-auto mb-3" />
          <p>No reports to review.</p>
        </div>
      ) : (
        <QueueClaimsProvider
          claims={claims}
          mustClaim={role === "moderator"}
          canFree={roleHasCapability(role, "decision:approve")}
        >
          <ReportsClient
            key={user.id}
            reports={reportsData}
            canEnforceDirectly={roleHasCapability(role, "enforcement:execute")}
          />
        </QueueClaimsProvider>
      )}
    </div>
  );
}
