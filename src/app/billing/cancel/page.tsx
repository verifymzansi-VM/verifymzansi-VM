import Link from "next/link";
import { XCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

export const metadata = {
  title: "Payment Cancelled | VerifyMzansi",
};

export default function BillingCancelPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1 flex items-center justify-center py-20">
        <div className="container-page max-w-lg text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <XCircle className="h-8 w-8 text-muted-foreground" />
          </div>

          <h1 className="font-display text-2xl font-bold">Payment Cancelled</h1>

          <Card>
            <CardContent className="p-6 space-y-4">
              <p className="text-muted-foreground">
                Your payment was cancelled. No charges were made to your account. You can try again
                anytime.
              </p>
              <p className="text-sm text-muted-foreground">
                If you experienced any issues during checkout, please contact our support team at{" "}
                <a href="mailto:support@verifymzansi.co.za" className="text-brand-green underline">
                  support@verifymzansi.co.za
                </a>
              </p>
            </CardContent>
          </Card>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild className="gap-2">
              <Link href="/billing">
                Try Again
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
