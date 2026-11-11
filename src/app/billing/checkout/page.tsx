import { redirect } from "next/navigation";
import { CheckoutConfirm } from "./checkout-confirm";
import { readFoundationCheckoutSummary } from "@/lib/foundation/checkout-summary";

export const metadata = { title: "Checkout", robots: { index: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan: planId } = await searchParams;
  if (!planId) redirect("/pricing");
  const summary = UUID.test(planId)
    ? await readFoundationCheckoutSummary(planId).catch(() => null)
    : null;
  return <CheckoutConfirm summary={summary} />;
}
