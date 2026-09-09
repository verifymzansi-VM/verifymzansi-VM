import "server-only";
import { listPlaywrightTableRows, writePlaywrightTableRows } from "./playwright-fixture-store";

/** UI fixture for subscription checkout only. This simulates the RPC contract;
 * database atomicity and authorization are covered by the isolated SQL tests. */
export function fulfillPlaywrightPayment(params: Record<string, unknown> = {}) {
  const fail = (message: string) => ({ data: null, error: { message } });
  const payments = listPlaywrightTableRows("payments");
  const payment = payments.find((row) => row.id === params.p_payment_id);
  if (!payment) return fail("Payment not found");
  if (payment.provider !== "ozow" || payment.amount_cents !== params.p_expected_amount)
    return fail("Payment provider or amount mismatch");
  if (
    !params.p_provider_payment_id ||
    (payment.provider_payment_id && payment.provider_payment_id !== params.p_provider_payment_id)
  )
    return fail("Payment ID mismatch");
  if (payment.status === "complete") return { data: { outcome: "duplicate" }, error: null };
  if (!["pending", "failed", "expired"].includes(String(payment.status)))
    return fail("Unsupported legacy payment in UI fixture");
  const data = payment.provider_data as Record<string, unknown>;
  const metadata = (data.metadata ?? data) as Record<string, unknown>;
  if (metadata.type !== "subscription") return fail("Addon RPC is not simulated in UI fixtures");
  const plan = listPlaywrightTableRows("plans").find((row) => row.id === params.p_plan_id);
  if (
    !plan?.active ||
    plan.price_cents !== payment.amount_cents ||
    plan.area !== payment.area ||
    metadata.area !== plan.area ||
    metadata.plan_tier !== plan.tier
  )
    return fail("Paid plan validation failed");
  const profile = listPlaywrightTableRows("account_profiles").find(
    (row) => row.user_id === payment.user_id
  );
  if (!profile) return fail("Account profile not found");
  const startedAt = String(payment.created_at);
  const expiresAt = new Date(Date.parse(startedAt) + 30 * 86400000).toISOString();
  const entitlements = listPlaywrightTableRows("entitlements");
  const existing = entitlements.find(
    (row) =>
      row.user_id === payment.user_id && row.area === plan.area && row.type === "subscription"
  );
  const entitlement = {
    id: existing?.id ?? crypto.randomUUID(),
    user_id: payment.user_id,
    area: plan.area,
    tier: plan.tier,
    type: "subscription",
    status: profile.account_status === "restricted" ? "pending_verification" : "active",
    cancelled_at: null,
    started_at: startedAt,
    expires_at: expiresAt,
  };
  if (existing) {
    if (Date.parse(String(existing.started_at)) <= Date.parse(startedAt))
      Object.assign(existing, entitlement);
  } else entitlements.push(entitlement);
  const invoices = listPlaywrightTableRows("invoices");
  if (!invoices.some((row) => row.payment_id === payment.id)) {
    const total = Number(payment.amount_cents);
    const vat = Math.round((total * 1500) / 11500);
    invoices.push({
      id: crypto.randomUUID(),
      user_id: payment.user_id,
      payment_id: payment.id,
      invoice_number: `FIXTURE-${payment.id}`,
      amount_cents: total - vat,
      vat_cents: vat,
      total_cents: total,
      description: `${plan.tier} subscription (${plan.area})`,
    });
  }
  payment.status = "complete";
  payment.provider_payment_id = params.p_provider_payment_id;
  payment.provider_data = {
    ...data,
    fulfillment_completed_at: new Date().toISOString(),
    fulfillment_protocol: "atomic_v1",
  };
  writePlaywrightTableRows("entitlements", entitlements);
  writePlaywrightTableRows("invoices", invoices);
  writePlaywrightTableRows("payments", payments);
  return { data: { outcome: "completed", expires_at: expiresAt }, error: null };
}
