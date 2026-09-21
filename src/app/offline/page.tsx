"use client";

import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-16">
      <div className="hero-panel flex w-full max-w-md flex-col items-center gap-6 px-6 py-10 text-center">
        <div className="empty-state-icon">
          <WifiOff className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="max-w-md space-y-2">
          <h1 className="font-display text-2xl font-bold tracking-tight">You&apos;re offline</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Check your connection and try again. Unsaved changes may be lost.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button
            variant="trust-verified"
            className="rounded-full font-semibold"
            onClick={() => window.location.reload()}
          >
            Try again
          </Button>
          <Button variant="outline" className="rounded-full" asChild>
            <Link href="/">Go to homepage</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
