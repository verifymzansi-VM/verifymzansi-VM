"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function VerificationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[VerificationError]", error.digest ?? error.message);
  }, [error]);

  return (
    <main id="main-content" className="container-page flex min-h-[60vh] items-center py-10">
      <div className="surface-card mx-auto w-full max-w-md p-6 text-center sm:p-8">
        <span
          aria-hidden="true"
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-red-50 text-brand-red-700 dark:bg-brand-red-500/15 dark:text-brand-red-300"
        >
          <ShieldAlert className="h-7 w-7" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">
          We couldn&apos;t load verification
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Something went wrong on our side. Anything you already submitted is saved.
        </p>
        {error.digest && (
          <p className="mt-3 text-xs text-muted-foreground">Error reference: {error.digest}</p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button variant="trust-verified" size="lg" onClick={() => reset()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() =>
              window.location.assign(new URL("/dashboard", window.location.origin).toString())
            }
          >
            Back to dashboard
          </Button>
        </div>
        <Link
          href="/help/verification"
          prefetch={false}
          className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-brand-green-700 underline-offset-4 hover:underline dark:text-brand-green-300"
        >
          Get verification help
        </Link>
      </div>
    </main>
  );
}
