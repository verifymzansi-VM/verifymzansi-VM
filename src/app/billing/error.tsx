"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPORT_CONTACT_EMAIL } from "@/lib/contact-email";

export default function BillingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[BillingError]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <div className="space-y-2">
        <h1 className="text-xl font-display font-bold">Billing Error</h1>
        <p className="text-muted-foreground max-w-md">
          Something went wrong with billing. Your payment has not been processed. Please try again
          or contact support at{" "}
          <Link href={`mailto:${SUPPORT_CONTACT_EMAIL}`} className="text-brand-green underline">
            {SUPPORT_CONTACT_EMAIL}
          </Link>
          .
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground">Error reference: {error.digest}</p>
        )}
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3 sm:flex-row">
        <Button
          variant="outline"
          className="h-11 w-full sm:w-auto"
          onClick={() => (window.location.href = "/dashboard")}
        >
          Back to Dashboard
        </Button>
        <Button className="h-11 w-full sm:w-auto" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
