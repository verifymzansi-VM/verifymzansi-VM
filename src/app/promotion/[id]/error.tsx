"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

export default function PromotionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[PromotionError]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <div className="space-y-2">
          <h1 className="text-xl font-display font-bold">Failed to load Tourism & Events post</h1>
          <p className="text-muted-foreground max-w-md">
            We couldn&apos;t load this Tourism & Events post. It may have been removed or there was
            a temporary issue. Please try again.
          </p>
        </div>
        <div className="flex w-full max-w-sm flex-col gap-3 sm:flex-row">
          <Button
            variant="outline"
            className="h-11 w-full sm:w-auto"
            onClick={() => (window.location.href = "/tourism-events")}
          >
            Browse Tourism & Events
          </Button>
          <Button className="h-11 w-full sm:w-auto" onClick={() => reset()}>
            Retry
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  );
}
