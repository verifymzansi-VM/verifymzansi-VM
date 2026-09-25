"use client";

import { useEffect } from "react";
import {
  ACQUISITION_COOKIE,
  ACQUISITION_MAX_AGE_SECONDS,
  buildAcquisitionTouch,
} from "@/lib/analytics/acquisition";

/**
 * Stores the first referral/UTM touch in a short-lived cookie so it can be
 * attributed when the visitor creates an account. First touch wins.
 */
export function AcquisitionCapture() {
  useEffect(() => {
    if (document.cookie.split("; ").some((c) => c.startsWith(`${ACQUISITION_COOKIE}=`))) return;
    const touch = buildAcquisitionTouch(
      window.location.search,
      window.location.pathname,
      document.referrer
    );
    if (!touch) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${ACQUISITION_COOKIE}=${encodeURIComponent(JSON.stringify(touch))}; Max-Age=${ACQUISITION_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  }, []);
  return null;
}
