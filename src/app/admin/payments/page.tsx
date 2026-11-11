import { requireStaff } from "@/lib/auth/require-staff";
import Link from "next/link";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFrontendStaffPayments, staffPaymentFilter } from "@/lib/foundation/staff-payments";
import { PaymentsPanel } from "@/components/admin/commercial/partners-panel";
import { PageHeader } from "@/components/layout/page-header";

const PAGE_SIZE = 50;

export const metadata = { title: "Payments & Refunds" };
export const dynamic = "force-dynamic";

export default async function PaymentsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const staff = await requireStaff("payments:view");
  const canRefund = staff.assignedCapabilities?.includes("payments:refund") === true;
  const params = await searchParams;
  const status = staffPaymentFilter.safeParse(params.status).data;
  const parsedPage = Number(params.page || 1);
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100_000) : 1;
  const { rows, total } = await (async () => {
    const { api } = await readFoundationServerSession();
    const result = await readFrontendStaffPayments(api, page, status);
    return { rows: result.items, total: result.total };
  })();
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
