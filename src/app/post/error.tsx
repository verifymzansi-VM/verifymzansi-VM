"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function PostError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[PostError]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 w-full border-b bg-background">
        <div className="container-page flex h-16 items-center">
          <Link href="/" className="text-lg font-bold">
            VerifyMzansi
          </Link>
        </div>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <div className="space-y-2">
          <h1 className="text-xl font-display font-bold">Something went wrong</h1>
          <p className="text-muted-foreground max-w-md">
            We couldn&apos;t load the form. Please try again or return to your dashboard.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => (window.location.href = "/dashboard")}>
            Dashboard
          </Button>
          <Button onClick={() => reset()}>Try again</Button>
        </div>
      </main>
    </div>
  );
}
