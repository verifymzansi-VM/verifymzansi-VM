"use client";

import { isTrackablePath } from "@/lib/site-visits";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Public-page navigation events; the server dedupes each browser/path for 30 minutes. */
export function SiteVisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    if (!isTrackablePath(pathname)) return;
    if (typeof navigator !== "undefined" && navigator.doNotTrack === "1") return;

    let referrer: string | null = null;
    try {
      const url = new URL(document.referrer);
      if (["https:", "http:"].includes(url.protocol)) referrer = url.origin;
    } catch {
      /* No usable referrer. */
    }
    const body = JSON.stringify({ path: pathname, referrer });

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/analytics/visit", blob)) return;
    }

    void fetch("/api/analytics/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Non-blocking analytics request: ignore failures.
    });
  }, [pathname]);

  return null;
}
