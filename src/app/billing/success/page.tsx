import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { createClient } from "@/lib/supabase/server";
import { toPaymentStatusView, type PaymentStatusView } from "@/lib/payments/status-view";
import PaymentStatusPanel from "./payment-status-panel";

export const metadata = {
  title: "Payment Status",
  description: "Review your VerifyMzansi payment status.",
};

async function resolvePaymentStatus(paymentId?: string): Promise<PaymentStatusView> {
  if (!paymentId) {
    return "missing";
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return "missing";
  }

  const { data: payment } = await supabase
    .from("payments")
    .select("status")
    .eq("id", paymentId)
    .eq("user_id", user.id)
    .maybeSingle();

  return toPaymentStatusView(payment?.status);
}

export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const { payment } = await searchParams;
  const status = await resolvePaymentStatus(payment);

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex flex-1 items-center justify-center py-4">
        <PaymentStatusPanel initialStatus={status} paymentId={payment} />
      </main>

      <Footer />
    </div>
  );
}
