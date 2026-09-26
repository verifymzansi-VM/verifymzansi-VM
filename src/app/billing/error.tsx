"use client";

import { useEffect } from "react";
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
    <main
      id="main-content"
      className="flex min-h-[70vh] items-center justify-center bg-background px-4 py-12"
    >
      <div className="w-full max-w-md rounded-3xl border border-border/70 bg-card p-6 text-center elev-md sm:p-8">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle aria-hidden="true" className="h-8 w-8" />
        </span>
        <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground">
          Billing didn&apos;t load
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Something went wrong on our side while loading billing. Try again in a moment. If you were
          charged, please don&apos;t pay twice: email{" "}
          <a
            href={`mailto:${SUPPORT_CONTACT_EMAIL}`}
            className="rounded-sm font-medium text-brand-green-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-green-300"
          >
            {SUPPORT_CONTACT_EMAIL}
          </a>{" "}
          and we&apos;ll sort it out.
        </p>
        {error.digest ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Error reference: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button
            variant="trust-verified"
            className="h-11 rounded-full px-6"
            onClick={() => reset()}
          >
            Try again
          </Button>
          <Button asChild variant="outline" className="h-11 rounded-full px-6">
            {/* Full navigation resets any broken client state from the failed render. */}
            <a href="/dashboard">Back to dashboard</a>
          </Button>
        </div>
      </div>
    </main>
  );
}
