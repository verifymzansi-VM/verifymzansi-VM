"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/shared/brand-logo";
import Link from "next/link";

export default function PostError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[PostError]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background">
        <div className="container-page flex h-16 items-center">
          <Link
            href="/"
            aria-label="VerifyMzansi home"
            className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandLogo />
          </Link>
        </div>
      </header>
      <main
        id="main-content"
        className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-12 text-center"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="h-7 w-7" aria-hidden="true" />
        </span>
        <div className="max-w-sm space-y-2">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            We couldn&apos;t load this form
          </h1>
          <p className="text-sm text-muted-foreground">
            Something went wrong on our side. Please try again.
          </p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-2 sm:max-w-none sm:flex-row sm:justify-center">
          <Button
            variant="trust-verified"
            className="h-11 rounded-full px-6"
            onClick={() => retry()}
          >
            Try again
          </Button>
          <Button
            variant="outline"
            className="h-11 rounded-full px-6"
            onClick={() =>
              window.location.assign(new URL("/dashboard", window.location.origin).toString())
            }
          >
            Dashboard
          </Button>
          <Button variant="ghost" className="h-11 rounded-full px-6" asChild>
            <Link href="/">Go to homepage</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
