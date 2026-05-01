import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasCapability } from "@/lib/auth/roles";
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

export const metadata = {
  title: "Revenue & Costs — Intelligence",
  description: "Financial overview and transaction analytics.",
};

type PaymentRow = {
  amount_cents?: unknown;
  status?: unknown;
  area?: unknown;
  created_at?: unknown;
};

type InvoiceRow = {
  amount_cents?: unknown;
  vat_cents?: unknown;
  total_cents?: unknown;
};

const PAYMENT_PAGE_SIZE = 1000;

function cents(value: unknown) {
  return Number(value) || 0;
}

function formatRand(centsValue: number) {
  return `R ${(centsValue / 100).toFixed(2)}`;
}

function monthKey(value: unknown) {
  if (typeof value !== "string") {
    return "Recorded";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recorded";
  }

  return date.toLocaleDateString("en-ZA", { month: "short", year: "2-digit" });
}

function sumRows(rows: PaymentRow[], predicate: (row: PaymentRow) => boolean) {
  return rows.reduce((sum, row) => (predicate(row) ? sum + cents(row.amount_cents) : sum), 0);
}

async function fetchPaymentRowsByStatus(
  admin: ReturnType<typeof createAdminClient>,
  status: "complete" | "failed" | "pending"
) {
  const rows: PaymentRow[] = [];

  for (let offset = 0; ; offset += PAYMENT_PAGE_SIZE) {
    const { data } = await admin
      .from("payments")
      .select("amount_cents,status,area,created_at")
      .eq("status", status)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAYMENT_PAGE_SIZE - 1);
    const pageRows = ((data as PaymentRow[] | null | undefined) ?? []) as PaymentRow[];
    rows.push(...pageRows);

    if (pageRows.length < PAYMENT_PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

async function fetchInvoiceRows(admin: ReturnType<typeof createAdminClient>) {
  const rows: InvoiceRow[] = [];

  for (let offset = 0; ; offset += PAYMENT_PAGE_SIZE) {
    const { data } = await admin
      .from("invoices")
      .select("amount_cents,vat_cents,total_cents")
      .range(offset, offset + PAYMENT_PAGE_SIZE - 1);
    const pageRows = ((data as InvoiceRow[] | null | undefined) ?? []) as InvoiceRow[];
    rows.push(...pageRows);

    if (pageRows.length < PAYMENT_PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

export default async function IntelligenceRevenuePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !hasCapability(user, "bi:view")) {
    redirect("/admin");
  }

  const admin = createAdminClient();

  const [
    { count: totalTransactions },
    completedPaymentRows,
    failedPaymentRows,
    pendingPaymentRows,
    invoiceRows,
  ] = await Promise.all([
    admin.from("payments").select("*", { count: "exact", head: true }),
    fetchPaymentRowsByStatus(admin, "complete"),
    fetchPaymentRowsByStatus(admin, "failed"),
    fetchPaymentRowsByStatus(admin, "pending"),
    fetchInvoiceRows(admin),
  ]);

  const total = totalTransactions ?? 0;
  const completed = completedPaymentRows.length;
  const failed = failedPaymentRows.length;
  const totalRevenue =
    completedPaymentRows.reduce((sum, payment) => sum + cents(payment.amount_cents), 0) ?? 0;
  const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const failedValue = sumRows(failedPaymentRows, () => true);
  const pendingValue = sumRows(pendingPaymentRows, () => true);
  const vatLiability = invoiceRows.reduce((sum, invoice) => sum + cents(invoice.vat_cents), 0);
  const invoiceGross = invoiceRows.reduce((sum, invoice) => sum + cents(invoice.total_cents), 0);
  const avgOrderValue = completed > 0 ? Math.round(totalRevenue / completed) : 0;
  const completedByArea = completedPaymentRows.reduce<Record<string, number>>((acc, row) => {
    const area = typeof row.area === "string" ? row.area.replaceAll("_", " ") : "Unclassified";
    acc[area] = (acc[area] ?? 0) + cents(row.amount_cents);
    return acc;
  }, {});
  const revenueMix: ChartDatum[] = Object.entries(completedByArea).map(([label, value], index) => ({
    label,
    value,
    caption: formatRand(value),
    tone: (["emerald", "sky", "violet", "amber"] as const)[index % 4],
  }));
  const monthlyRevenueMap = completedPaymentRows.reduce<Record<string, number>>((acc, row) => {
    const key = monthKey(row.created_at);
    acc[key] = (acc[key] ?? 0) + cents(row.amount_cents);
    return acc;
  }, {});
  const monthlyRevenue: ChartDatum[] =
    Object.entries(monthlyRevenueMap).length > 0
      ? Object.entries(monthlyRevenueMap).map(([label, value]) => ({
          label,
          value: Math.round(value / 100),
          tone: "emerald",
        }))
      : [{ label: "No revenue", value: 0, tone: "slate" }];
  const leakageData: ChartDatum[] = [
    {
      label: "Completed revenue",
      value: totalRevenue,
      caption: formatRand(totalRevenue),
      tone: "emerald",
    },
    {
      label: "Failed payment value",
      value: failedValue,
      caption: formatRand(failedValue),
      tone: "rose",
    },
    {
      label: "Pending payment value",
      value: pendingValue,
      caption: formatRand(pendingValue),
      tone: "amber",
    },
    {
      label: "VAT on invoices",
      value: vatLiability,
      caption: formatRand(vatLiability),
      tone: "sky",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revenue & Costs"
        description="Financial analytics and transaction tracking."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Revenue & Costs" }]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R {(totalRevenue / 100).toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              {formatRand(avgOrderValue)} average paid order
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
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{successRate}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <TrendingUp className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{failed}</div>
            <p className="text-xs text-muted-foreground">{formatRand(failedValue)} not captured</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ColumnChartPanel
          title="Revenue trend"
          description="Completed payment value grouped by recorded month."
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
          title="Decision notes"
          description="Use these signals to decide where to focus commercial and finance work."
          items={[
            {
              label: "Cash collection quality",
              value: `${successRate}%`,
              detail:
                successRate >= 95
                  ? "Payment completion is healthy. Focus on growing paid inventory and improving average order value."
                  : "Payment completion needs attention. Review failed checkout reasons before scaling paid campaigns.",
              tone: successRate >= 95 ? "emerald" : "amber",
            },
            {
              label: "Finance visibility",
              value: formatRand(invoiceGross),
              detail:
                "Invoices provide VAT visibility, but gateway fees or infrastructure costs are not modelled in the current schema.",
              tone: "sky",
            },
            {
              label: "Leakage to recover",
              value: formatRand(failedValue + pendingValue),
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
