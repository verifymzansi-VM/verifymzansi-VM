"use client";

import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AdminError]", error.digest ?? error.message);
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
      <main className="flex-1 flex flex-col items-center justify-center gap-6 px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <ShieldAlert className="h-7 w-7 text-destructive" />
        </div>
        <div className="max-w-md space-y-2">
          <h1 className="text-lg sm:text-xl font-display font-bold">Admin Panel Error</h1>
          <p className="text-sm text-muted-foreground">
            An error occurred in the admin panel. If this persists, contact the engineering team.
          </p>
          {error.digest && <p className="text-xs text-muted-foreground">Ref: {error.digest}</p>}
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="outline" asChild>
            <Link href="/">Go Home</Link>
          </Button>
          <Button variant="outline" onClick={() => (window.location.href = "/admin")}>
            Reload Admin
          </Button>
          <Button onClick={() => reset()}>Retry</Button>
        </div>
      </main>
    </div>
  );
}
