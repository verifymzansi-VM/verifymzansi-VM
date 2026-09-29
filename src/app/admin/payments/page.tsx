import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { roleHasCapability } from "@/lib/auth/admin-access";
import Link from "next/link";
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

export default async function PaymentsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { role } = await requireStaff("bi:view");
  const canRefund = roleHasCapability(role, "payments:refund");

  const params = await searchParams;
  const status = params.status && /^[a-z_]{3,20}$/.test(params.status) ? params.status : undefined;
  const parsedPage = Number(params.page || 1);
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100_000) : 1;
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

  const total = count ?? rows.length;
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
