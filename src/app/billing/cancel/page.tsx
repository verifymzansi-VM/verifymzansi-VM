import Link from "next/link";
import { XCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

export const metadata = {
  title: "Payment Cancelled",
  description: "Your payment was cancelled. You can try again from the billing page.",
};

export default function BillingCancelPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1 flex items-center justify-center py-4">
        <div className="container-page max-w-md text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <XCircle className="h-6 w-6 text-muted-foreground" />
          </div>

          <h1 className="font-display text-xl font-bold">Payment Cancelled</h1>

          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">No charges were made to your account.</p>
              <p className="text-xs text-muted-foreground">
                Having issues? Contact{" "}
                <a
                  href="mailto:support@verifymzansi.co.za"
                  className="text-brand-green underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                >
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
