"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

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
          or contact support.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground">Error reference: {error.digest}</p>
        )}
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => (window.location.href = "/dashboard")}>
          Back to Dashboard
        </Button>
        <Button onClick={() => reset()}>Retry</Button>
      </div>
    </div>
  );
}
