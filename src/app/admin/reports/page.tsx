import { requireStaff } from "@/lib/auth/require-staff";
import { roleHasCapability } from "@/lib/auth/admin-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { countMyClaims, getClaimsForItems } from "@/lib/services/queue-claims";
import { createLogger } from "@/lib/utils/logger";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { QueueClaimBar, QueueClaimsProvider } from "@/components/admin/queue-claims";
import { Flag } from "lucide-react";
import { ReportsClient } from "./reports-client";
import type { Report } from "@/types/database";

export const metadata = {
  title: "Reports — Admin",
  description: "Review user-submitted reports on listings, businesses, and users.",
};

const OPEN_LIMIT = 200;
const RECENT_CLOSED_LIMIT = 50;

export default async function AdminReportsPage() {
  const { user, role } = await requireStaff("queue:view");
  const admin = createAdminClient();

  // Every open report stays reachable: open ones are loaded first (highest
  // severity, oldest first), then work in progress and the latest closed.
  const [openResult, activeResult, closedResult, myClaims] = await Promise.all([
    admin
      .from("reports")
      .select("*", { count: "exact" })
      .eq("status", "open")
      .order("severity", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(OPEN_LIMIT),
    admin
      .from("reports")
      .select("*")
      .eq("status", "in_progress")
      .order("created_at", { ascending: true })
      .limit(OPEN_LIMIT),
    admin
      .from("reports")
      .select("*")
      .in("status", ["resolved", "dismissed"])
      .order("updated_at", { ascending: false })
      .limit(RECENT_CLOSED_LIMIT),
    countMyClaims(user.id, "reports"),
  ]);

  if (openResult.error || activeResult.error || closedResult.error) {
    createLogger("AdminReportsPage").error("Reports read failed", {
      error: (openResult.error ?? activeResult.error ?? closedResult.error)?.message,
    });
    return (
      <p role="alert">
        Reports could not be loaded. Refresh to try again. This does not mean there are no reports.
      </p>
    );
  }

  const open = (openResult.data ?? []) as Report[];
  const reportsData = [
    ...open,
    ...((activeResult.data ?? []) as Report[]),
    ...((closedResult.data ?? []) as Report[]),
  ];
  const openTotal = openResult.count ?? open.length;
  const claims = await getClaimsForItems(
    user.id,
    open.map((r) => ({ type: "report" as const, id: r.id }))
  );

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
            reports={reportsData}
            canEnforceDirectly={roleHasCapability(role, "enforcement:execute")}
          />
        </QueueClaimsProvider>
      )}
    </div>
  );
}
