import Link from "next/link";
import { ArrowRight, AlertCircle, Clock3, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Payment Status",
  description: "Review the current status of your VerifyMzansi payment.",
};

type PaymentStatusView = "complete" | "pending" | "failed" | "expired" | "missing";

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

  switch (payment?.status) {
    case "complete":
      return "complete";
    case "pending":
    case "processing":
      return "pending";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    default:
      return "missing";
  }
}

function getCopy(status: PaymentStatusView) {
  switch (status) {
    case "complete":
      return {
        icon: <CheckCircle2 className="h-6 w-6 text-brand-green" />,
        title: "Payment Already Confirmed",
        description:
          "This payment has already completed successfully, even though you returned here.",
      };
    case "pending":
      return {
        icon: <Clock3 className="h-6 w-6 text-brand-green" />,
        title: "Payment Still Pending",
        description:
          "We have not received the final payment confirmation yet. Please check again shortly.",
      };
    case "failed":
      return {
        icon: <XCircle className="h-6 w-6 text-destructive" />,
        title: "Payment Not Completed",
        description:
          "Your payment was not completed. This could be because you cancelled, or because there was a processing issue. No charge was made.",
      };
    case "expired":
      return {
        icon: <AlertCircle className="h-6 w-6 text-destructive" />,
        title: "Payment Expired",
        description: "This checkout session expired. Start a new payment to continue.",
      };
    default:
      return {
        icon: <AlertCircle className="h-6 w-6 text-muted-foreground" />,
        title: "Payment Not Found",
        description: "We could not resolve a matching payment for this request.",
      };
  }
}

export default async function BillingCancelPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const { payment } = await searchParams;
  const status = await resolvePaymentStatus(payment);
  const copy = getCopy(status);

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex flex-1 items-center justify-center py-4">
        <div className="container-page max-w-md space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            {copy.icon}
          </div>

          <h1 className="font-display text-xl font-bold">{copy.title}</h1>

          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm text-muted-foreground">{copy.description}</p>
              <p className="text-xs text-muted-foreground">
                Need help? Contact{" "}
                <a
                  href="mailto:support@verifymzansi.com"
                  className="rounded-sm text-brand-green underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  support@verifymzansi.com
                </a>
              </p>
            </CardContent>
          </Card>

          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild className="gap-2">
              <Link href="/billing">
                View Plans
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard">Back to Dashboard</Link>
            </Button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
