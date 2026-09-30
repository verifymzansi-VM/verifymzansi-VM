"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { AuthIconTile, AuthPageHeader } from "@/components/auth/auth-ui";
import { Button } from "@/components/ui/button";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AuthError]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="space-y-6">
      <AuthPageHeader
        icon={
          <AuthIconTile tone="red">
            <AlertTriangle />
          </AuthIconTile>
        }
        title="We couldn't load this page"
        description="Something went wrong on our side. Please try again."
      />

      {error.digest && (
        <p className="rounded-xl bg-muted/60 px-3.5 py-2.5 text-xs text-muted-foreground">
          Reference for support: <span className="font-mono text-foreground">{error.digest}</span>
        </p>
      )}

      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="trust-verified"
          size="lg"
          className="h-11 w-full gap-2 text-[15px]"
          onClick={() => reset()}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
        <Button asChild variant="outline" size="lg" className="h-11 w-full text-[15px]">
          <Link href="/">Go to homepage</Link>
        </Button>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Still stuck?{" "}
        <Link
          href="/contact"
          className="font-semibold text-brand-green-700 underline underline-offset-4 dark:text-brand-green-300"
        >
          Contact support
        </Link>
      </p>
    </div>
  );
}
