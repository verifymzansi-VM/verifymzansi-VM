"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Rendered once a Multi-listing package payment is confirmed while the page
 * was open: reloads the page's server data once, so the package confirmation
 * (slots, start and end) replaces the general one. If the package cannot be
 * read, the general confirmation stays.
 */
export function PackageRefresh() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
