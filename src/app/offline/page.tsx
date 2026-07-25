"use client";

import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="rounded-2xl bg-warm-100 p-4 ring-1 ring-warm-200 dark:bg-warm-900 dark:ring-warm-700">
        <WifiOff className="h-7 w-7 text-warm-500 dark:text-warm-400" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h1 className="font-display text-2xl font-bold tracking-tight">You&apos;re offline</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Check your connection and try again. Unsaved changes may be lost.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={() => window.location.reload()}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/">Go to homepage</Link>
        </Button>
      </div>
    </div>
  );
}
