"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <div className="space-y-1.5">
        <h1 className="text-xl font-display font-bold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          An unexpected error occurred. Please try again or return to the homepage.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground">Error reference: {error.digest}</p>
        )}
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => (window.location.href = "/")}>
          Go Home
        </Button>
        <Button onClick={() => reset()}>Try Again</Button>
      </div>
    </div>
  );
}
