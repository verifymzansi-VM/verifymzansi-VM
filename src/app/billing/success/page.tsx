import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { resolveCurrentUserPaymentStatus } from "@/lib/payments/resolve-payment-status";
import { readPackageConfirmation } from "@/lib/payments/package-confirmation";
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
  const [status, packageConfirmation] = await Promise.all([
    resolveCurrentUserPaymentStatus(payment),
    readPackageConfirmation(payment),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main
        id="main-content"
        className="bg-hero-mesh flex flex-1 scroll-mt-24 items-center justify-center py-10 sm:py-16"
      >
        <PaymentStatusPanel
          initialStatus={status}
          paymentId={payment}
          packagePayment={packageConfirmation.packagePayment}
          packageDetails={packageConfirmation.details}
        />
      </main>

      <Footer />
    </div>
  );
}
