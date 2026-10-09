"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BrandShieldAlert as ShieldAlert } from "@/components/shared/brand-shield";
import { Button } from "@/components/ui/button";

/**
 * Shown inside the admin layout, so the header and menu stay in place and
 * staff can move to another page.
 */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[AdminError]", error.digest ?? error.message);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-5 px-4 py-16 text-center"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <ShieldAlert className="h-7 w-7 text-destructive" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="font-display text-lg font-bold sm:text-xl">This page could not load</h1>
        <p className="text-sm text-muted-foreground">
          Nothing was changed. Try again, or open another page from the menu. If it keeps happening,
          send the reference below to the platform team.
        </p>
        {error.digest && <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={() => retry()} className="h-11">
          Try again
        </Button>
        <Button variant="outline" asChild className="h-11">
          <Link href="/admin">Go to admin home</Link>
        </Button>
      </div>
    </div>
  );
}
