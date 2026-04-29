import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { resolveCurrentUserPaymentStatus } from "@/lib/payments/resolve-payment-status";
import PaymentStatusPanel from "./payment-status-panel";

export const metadata = {
  title: "Payment Status",
  description: "Review your VerifyMzansi payment status.",
};

export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const { payment } = await searchParams;
  const status = await resolveCurrentUserPaymentStatus(payment);

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main id="main-content" className="flex flex-1 items-center justify-center py-4 scroll-mt-24">
        <PaymentStatusPanel initialStatus={status} paymentId={payment} />
      </main>

      <Footer />
    </div>
  );
}
