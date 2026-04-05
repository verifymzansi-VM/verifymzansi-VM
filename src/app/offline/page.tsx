"use client";

import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <WifiOff className="mb-3 h-10 w-10 text-muted-foreground" />
      <h1 className="text-2xl font-display font-bold">You&apos;re Offline</h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        You&apos;re currently offline. Check your internet connection and try again. Any unsaved
        changes may be lost.
      </p>
      <div className="mt-6 flex gap-3">
        <Button onClick={() => window.location.reload()}>Try Again</Button>
        <Button variant="outline" asChild>
          <Link href="/">Go to Homepage</Link>
        </Button>
      </div>
    </div>
  );
}
