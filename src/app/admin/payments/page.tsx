import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { roleHasCapability } from "@/lib/auth/admin-access";
import Link from "next/link";
import { getDataBackend } from "@/lib/data-backend";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readStaffPaymentList, staffPaymentListFilter } from "@/lib/foundation/staff-payments";
import { PaymentsPanel, type AdminPaymentRow } from "@/components/admin/commercial/partners-panel";
import { PageHeader } from "@/components/layout/page-header";

const PAGE_SIZE = 50;

export const metadata = { title: "Payments & Refunds" };
export const dynamic = "force-dynamic";

function describe(providerData: unknown): string {
  const data =
    providerData && typeof providerData === "object"
      ? (providerData as Record<string, unknown>)
      : {};
  const meta =
    data.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>)
      : data;
  if (typeof meta.plan_name === "string") return meta.plan_name;
  if (typeof meta.plan_tier === "string") return `${meta.plan_tier} plan`;
  return typeof meta.type === "string" ? meta.type.replace(/_/g, " ") : "Payment";
}

async function readSourcePayments(page: number, status?: string) {
  let query = createAdminClient()
    .from("payments")
    .select("id, user_id, area, amount_cents, status, created_at, provider_data", {
      count: status ? "exact" : "estimated",
    })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw new Error("Unable to load payments");

  const rows: AdminPaymentRow[] = (data ?? []).map((row) => ({
    id: row.id,
    user_id: row.user_id,
    area: row.area,
    amount_cents: row.amount_cents,
    status: row.status,
    created_at: row.created_at,
    description: describe(row.provider_data),
  }));

  return { rows, total: count ?? rows.length };
}

export default async function PaymentsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const native = getDataBackend() === "foundation";
  const staff = await requireStaff("payments:view");

  const canRefund = native
    ? staff.assignedCapabilities?.includes("payments:refund") === true
    : roleHasCapability(staff.role, "payments:refund");
  const params = await searchParams;
  const nativeStatus = staffPaymentListFilter.safeParse(params.status).data;
  const status = native
    ? nativeStatus
    : params.status && /^[a-z_]{3,20}$/.test(params.status)
      ? params.status
      : undefined;
  const parsedPage = Number(params.page || 1);
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100_000) : 1;
  const { rows, total, needsAttention, awaitingApproval } = native
    ? await (async () => {
        const { api } = await readFoundationServerSession();
        const result = await readStaffPaymentList(api, page, nativeStatus);
        return {
          rows: result.items,
          total: result.total,
          needsAttention: result.needs_attention,
          awaitingApproval: result.awaiting_approval,
        };
      })()
    : { ...(await readSourcePayments(page, status)), needsAttention: 0, awaitingApproval: 0 };

  const hrefFor = (nextPage: number) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (nextPage > 1) query.set("page", String(nextPage));
    const qs = query.toString();
    return qs ? `/admin/payments?${qs}` : "/admin/payments";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments & Refunds"
        description="Newest first. Refunds and chargebacks are for admins only."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Payments & Refunds" }]}
      />
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <label>
          Status
          <select
            name="status"
            defaultValue={status ?? ""}
            className="mt-1 block rounded-md border bg-background p-2"
          >
            <option value="">All</option>
            {native ? (
              <>
                <option value="needs_attention">needs attention (paid, not delivered)</option>
                <option value="awaiting_approval">refund waiting for approval</option>
              </>
            ) : null}
            {[
              "pending",
              "processing",
              "complete",
              "failed",
              "expired",
              "refunded",
              "chargeback",
              "cancelled",
            ].map((s) => (
              <option key={s} value={s}>
                {s === "complete" ? "paid" : s}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-11 rounded-md border px-4">
          Filter
        </button>
      </form>
      {needsAttention > 0 || awaitingApproval > 0 ? (
        <p role="status" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {needsAttention > 0 && status !== "needs_attention" ? (
            <Link href="/admin/payments?status=needs_attention" className="font-medium underline">
              {needsAttention.toLocaleString("en-ZA")} paid but not delivered: needs attention
            </Link>
          ) : null}
          {awaitingApproval > 0 && status !== "awaiting_approval" ? (
            <Link href="/admin/payments?status=awaiting_approval" className="font-medium underline">
              {awaitingApproval.toLocaleString("en-ZA")}{" "}
              {awaitingApproval === 1 ? "refund waits" : "refunds wait"} for approval
            </Link>
          ) : null}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {status ? "" : "About "}
        {total.toLocaleString("en-ZA")} {total === 1 ? "payment" : "payments"}
        {total > PAGE_SIZE && ` · Page ${page} of ${Math.ceil(total / PAGE_SIZE)}`}
      </p>
      <PaymentsPanel payments={rows} canRefund={canRefund} />
      {(page > 1 || rows.length === PAGE_SIZE) && (
        <nav aria-label="Payment pages" className="flex gap-4 text-sm">
          {page > 1 && (
            <Link href={hrefFor(page - 1)} className="underline">
              Newer payments
            </Link>
          )}
          {rows.length === PAGE_SIZE && (!status || page * PAGE_SIZE < total) && (
            <Link href={hrefFor(page + 1)} className="underline">
              Older payments
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
