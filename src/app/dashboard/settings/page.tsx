"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Settings page now redirects to the unified profile hub.
 * Kept as a client redirect to preserve bookmarks and shared links.
 */
export default function SettingsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/profile#account");
  }, [router]);

  return null;
}
