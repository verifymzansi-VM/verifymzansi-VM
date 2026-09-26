"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Renders inside the dashboard layout (header and navigation stay in place),
 * so it must not add its own header or <main>.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[DashboardError]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-16 text-center">
      <span
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-red-100 text-brand-red-700 dark:bg-brand-red-500/15 dark:text-brand-red-300"
      >
        <AlertTriangle className="h-7 w-7" />
      </span>
      <div className="space-y-1.5">
        <h1 className="font-display text-xl font-bold sm:text-2xl">This page didn&apos;t load</h1>
        <p className="text-sm text-muted-foreground">
          Something went wrong on our side. Try again, or reload your dashboard.
        </p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button onClick={() => reset()} variant="trust-verified" className="h-11 rounded-full px-5">
          Try again
        </Button>
        <Button
          variant="outline"
          className="h-11 rounded-full px-5"
          onClick={() =>
            window.location.assign(new URL("/dashboard", window.location.origin).toString())
          }
        >
          Reload dashboard
        </Button>
      </div>
      <Link href="/help" className="text-sm text-muted-foreground underline underline-offset-4">
        Get help
      </Link>
    </div>
  );
}
