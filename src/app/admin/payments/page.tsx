import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCapabilityFromDb } from "@/lib/auth/admin-access";
import { PaymentsPanel, type AdminPaymentRow } from "@/components/admin/commercial/partners-panel";

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
  searchParams: Promise<{ status?: string }>;
}) {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  if (!(await verifyCapabilityFromDb(user, "bi:view"))) redirect("/admin");
  const canRefund = await verifyCapabilityFromDb(user, "payments:refund");

  const { status } = await searchParams;
  let query = createAdminClient()
    .from("payments")
    .select("id, user_id, area, amount_cents, status, created_at, provider_data")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status && /^[a-z_]{3,20}$/.test(status)) query = query.eq("status", status);
  const { data, error } = await query;
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

  return (
    <div className="space-y-6 p-4">
      <h1 className="text-2xl font-bold">Payments &amp; Refunds</h1>
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
      <PaymentsPanel payments={rows} canRefund={canRefund} />
    </div>
  );
}
