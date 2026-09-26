"use client";

import Link from "next/link";
import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OfflinePage() {
  return (
    <main
      id="main-content"
      className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-16"
    >
      <div className="hero-panel flex w-full max-w-md flex-col items-center px-6 py-10 text-center">
        <div className="empty-state-icon">
          <WifiOff className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-bold tracking-tight">You&apos;re offline</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Check your data or Wi-Fi and try again. Unsaved changes may be lost.
        </p>
        <div className="mt-6 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
          <Button
            variant="trust-verified"
            className="h-11"
            onClick={() => window.location.reload()}
          >
            Try again
          </Button>
          <Button variant="outline" className="h-11" asChild>
            <Link href="/">Go to homepage</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
