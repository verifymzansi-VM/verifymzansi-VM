import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

export const metadata = {
  title: "Payment Successful",
};

export default function BillingSuccessPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1 flex items-center justify-center py-12">
        <div className="container-page max-w-lg text-center space-y-5">
          <div className="mx-auto w-12 h-12 rounded-full bg-brand-green/10 flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6 text-brand-green" />
          </div>

          <h1 className="font-display text-2xl font-bold">Payment Successful!</h1>

          <Card>
            <CardContent className="p-6 space-y-4">
              <p className="text-muted-foreground">
                Your plan has been upgraded successfully. You now have access to all the features
                included in your new plan.
              </p>

              <div className="border-t pt-4 space-y-2">
                <p className="text-sm text-muted-foreground">What&apos;s next?</p>
                <ul className="text-sm space-y-1 text-left">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-brand-green flex-shrink-0 mt-0.5" />
                    Your trust badge has been updated
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-brand-green flex-shrink-0 mt-0.5" />
                    Premium features are now active on your listings
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-brand-green flex-shrink-0 mt-0.5" />A
                    receipt has been sent to your email
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild className="gap-2">
              <Link href="/dashboard">
                Go to Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/billing">View Billing</Link>
            </Button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
