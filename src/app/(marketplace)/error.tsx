"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

export default function MarketplaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[MarketplaceError]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <div className="space-y-2">
          <h1 className="text-xl font-display font-bold">Failed to load marketplace</h1>
          <p className="text-muted-foreground max-w-md">
            We couldn&apos;t load the page. This may be a temporary issue — please try again.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => (window.location.href = "/")}>
            Go to homepage
          </Button>
          <Button onClick={() => reset()}>Retry</Button>
        </div>
      </main>
      <Footer />
    </div>
  );
}
