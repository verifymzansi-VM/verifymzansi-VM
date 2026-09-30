"use client";

import Link from "next/link";
import { LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { buildLoginUrl } from "@/lib/utils/navigation";

/**
 * "Sign in" recovery link for create-post forms whose session expired
 * mid-submit. Returns the poster to the page they are on after sign-in so the
 * autosaved draft is restored.
 */
export function PostSignInAction() {
  const href =
    typeof window === "undefined"
      ? "/login"
      : buildLoginUrl(`${window.location.pathname}${window.location.search}`);

  return (
    <Button asChild size="sm" variant="default" className="gap-1.5">
      <Link href={href}>
        <LogIn className="h-4 w-4" aria-hidden="true" />
        Sign in
      </Link>
    </Button>
  );
}
