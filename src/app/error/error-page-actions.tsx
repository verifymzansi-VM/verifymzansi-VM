"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useSignedInShell } from "@/components/providers/session-hint-provider";

/**
 * Members go back to their dashboard; signed-out visitors, for whom the
 * dashboard is only a sign-in page, go back to browsing.
 */
export function ErrorPageActions() {
  const signedIn = useSignedInShell(useAuth());

  if (!signedIn) {
    return (
      <Button asChild variant="trust-verified">
        <Link href="/">Go to homepage</Link>
      </Button>
    );
  }

  return (
    <>
      <Button asChild variant="trust-verified">
        <Link href="/dashboard">Go to dashboard</Link>
      </Button>
      <Button asChild variant="outline">
        <Link href="/">Go to homepage</Link>
      </Button>
    </>
  );
}
