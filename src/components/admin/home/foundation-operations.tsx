import { CostOverviewPanel } from "@/components/admin/cost-overview-panel";
import { FoundationCostAlarms } from "@/components/admin/foundation-cost-alarms";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFoundationStaffCosts } from "@/lib/foundation/staff-costs";
import { readFoundationStaffDashboard } from "@/lib/foundation/staff-dashboard";
import { PageHeader } from "@/components/layout/page-header";
export async function FoundationOperations() {
  const current = await readFoundationServerSession();
  const dashboard = await readFoundationStaffDashboard();
  const capabilities = current.account.staff?.assigned_capabilities ?? [];
  const costs = capabilities.includes("cost:view")
    ? await readFoundationStaffCosts(current.api)
    : null;
  return (
    <div className="space-y-7">
      <PageHeader
        title="Operations summary"
        description="Current moderation workload and measured platform use."
      />
      <dl className="grid gap-4 rounded-lg border p-5 sm:grid-cols-4">
        {Object.entries({
          "Open reports": dashboard.counts.reports,
          "Posts awaiting review": dashboard.counts.content,
          "Identity checks": dashboard.counts.kyc,
          "Proposed decisions": dashboard.counts.decisions,
        }).map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {costs && <CostOverviewPanel overview={costs} />}
      {costs && capabilities.includes("cost:acknowledge") && (
        <FoundationCostAlarms accountId={current.account.account_id} alarms={costs.open_alarms} />
      )}
    </div>
  );
}
