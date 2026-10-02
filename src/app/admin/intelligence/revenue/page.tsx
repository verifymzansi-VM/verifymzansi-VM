import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ColumnChartPanel,
  DecisionPanel,
  HorizontalBarPanel,
  type ChartDatum,
} from "@/components/admin/intelligence-panels";
import { TrendingUp, DollarSign, CreditCard, ArrowUpRight } from "lucide-react";
import { createLogger } from "@/lib/utils/logger";
import { formatZAR } from "@/lib/utils/format";

export const metadata = {
  title: "Revenue & costs — Intelligence",
  description: "Financial overview and transaction analytics.",
};

/** From revenue_summary() (20260929130000_admin_list_helpers.sql). */
interface RevenueSummary {
  transactions: number;
  completed_count: number;
  completed_cents: number;
  failed_count: number;
  failed_cents: number;
  pending_cents: number;
  by_area: Array<{ area: string; cents: number }>;
  by_month: Array<{ month: string; cents: number }>;
  invoice_vat_cents: number;
  invoice_total_cents: number;
}

function monthLabel(month: string) {
  return new Date(`${month}-01T12:00:00+02:00`).toLocaleDateString("en-ZA", {
    month: "short",
    year: "2-digit",
    timeZone: "Africa/Johannesburg",
  });
}

export default async function IntelligenceRevenuePage() {
  await requireStaff("bi:view");

  // Totals are summed in the database; the page never reads payment rows.
  const { data, error } = await createAdminClient().rpc("revenue_summary");
  if (error || !data) {
    createLogger("IntelligenceRevenue").error("Revenue summary failed", {
      error: error?.message ?? "no data",
    });
    return (
      <p role="alert">
        Revenue could not be loaded. Refresh to try again. This does not mean there was no revenue.
      </p>
    );
  }
  const summary = data as RevenueSummary;

  const total = summary.transactions;
  const completed = summary.completed_count;
  const failed = summary.failed_count;
  const totalRevenue = summary.completed_cents;
  // No payments yet means no rate: never a 0% that reads as every payment failing.
  const successRate = total > 0 ? Math.round((completed / total) * 100) : null;
  const failedValue = summary.failed_cents;
  const pendingValue = summary.pending_cents;
  const vatLiability = summary.invoice_vat_cents;
  const invoiceGross = summary.invoice_total_cents;
  const avgOrderValue = completed > 0 ? Math.round(totalRevenue / completed) : 0;
  const revenueMix: ChartDatum[] = summary.by_area.map(({ area, cents }, index) => ({
    label: area.replaceAll("_", " "),
    value: cents,
    caption: formatZAR(cents),
    tone: (["emerald", "sky", "violet", "amber"] as const)[index % 4],
  }));
  const monthlyRevenue: ChartDatum[] =
    summary.by_month.length > 0
      ? summary.by_month.map(({ month, cents }) => ({
          label: monthLabel(month),
          value: Math.round(cents / 100),
          tone: "emerald",
        }))
      : [{ label: "No revenue", value: 0, tone: "slate" }];
  const leakageData: ChartDatum[] = [
    {
      label: "Completed revenue",
      value: totalRevenue,
      caption: formatZAR(totalRevenue),
      tone: "emerald",
    },
    {
      label: "Failed payment value",
      value: failedValue,
      caption: formatZAR(failedValue),
      tone: "rose",
    },
    {
      label: "Pending payment value",
      value: pendingValue,
      caption: formatZAR(pendingValue),
      tone: "amber",
    },
    {
      label: "VAT on invoices",
      value: vatLiability,
      caption: formatZAR(vatLiability),
      tone: "sky",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revenue & costs"
        description="Financial analytics and transaction tracking."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Revenue & costs" }]}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatZAR(totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">
              {formatZAR(avgOrderValue)} average paid order
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Transactions</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success rate</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {successRate === null ? "—" : `${successRate}%`}
            </div>
            {successRate === null && (
              <p className="text-xs text-muted-foreground">No payments yet</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <TrendingUp className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{failed}</div>
            <p className="text-xs text-muted-foreground">{formatZAR(failedValue)} not captured</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ColumnChartPanel
          title="Revenue trend"
          description="Completed payment value by month, last 12 months."
          data={monthlyRevenue}
          valuePrefix="R "
        />
        <HorizontalBarPanel
          title="Revenue and cost signals"
          description="Shows captured revenue, failed/pending payment leakage, and invoice VAT exposure."
          data={leakageData}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <HorizontalBarPanel
          title="Revenue mix by platform area"
          description="Helps identify which marketplace surface is carrying monetisation."
          data={
            revenueMix.length > 0
              ? revenueMix
              : [{ label: "No completed revenue", value: 0, tone: "slate" }]
          }
        />
        <DecisionPanel
          title="What this means"
          description="Use these signals to decide where to focus commercial and finance work."
          items={[
            {
              label: "Cash collection quality",
              value: successRate === null ? "—" : `${successRate}%`,
              detail:
                successRate === null
                  ? "No payments yet. This fills in after the first paid order."
                  : successRate >= 95
                    ? "Payment completion is healthy. Focus on growing paid inventory and improving average order value."
                    : "Payment completion needs attention. Review failed checkout reasons before scaling paid campaigns.",
              tone: successRate === null ? "slate" : successRate >= 95 ? "emerald" : "amber",
            },
            {
              label: "Finance visibility",
              value: formatZAR(invoiceGross),
              detail:
                "Invoices provide VAT visibility, but gateway fees or infrastructure costs are not modelled in the current schema.",
              tone: "sky",
            },
            {
              label: "Leakage to recover",
              value: formatZAR(failedValue + pendingValue),
              detail:
                "Follow up failed and pending payments before treating demand as lost. This is the fastest near-term revenue lever.",
              tone: failedValue + pendingValue > 0 ? "rose" : "emerald",
            },
          ]}
        />
      </div>
    </div>
  );
}
