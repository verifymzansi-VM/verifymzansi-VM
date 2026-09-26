"use client";

import { useEffect } from "react";
import {
  CONTENT_SHARED_EVENT,
  trackCommercialEvents,
  trackContactAction,
  type CommercialEventTable,
} from "@/lib/analytics/commercial-events";

/**
 * Records one detail view and classifies contact clicks on the page
 * (WhatsApp, phone, external website) for the owner's and organisation's
 * aggregate reports. Uses a delegated listener so contact buttons stay plain links.
 */
export function ContactActionTracker({
  table,
  id,
  website,
}: {
  table: CommercialEventTable;
  id: string | null | undefined;
  website?: string | null;
}) {
  useEffect(() => {
    if (!id) return;
    trackCommercialEvents([{ table, id, type: "detail_view", surface: "detail" }]);

    let websiteHost: string | null = null;
    try {
      websiteHost = website ? new URL(website).hostname : null;
    } catch {
      websiteHost = null;
    }

    function onClick(event: MouseEvent) {
      const anchor = (event.target as Element | null)?.closest?.(
        "a[href]"
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(href)) {
        trackContactAction(table, id, "whatsapp_click", "detail");
      } else if (href.startsWith("tel:")) {
        trackContactAction(table, id, "phone_click", "detail");
      } else if (websiteHost) {
        try {
          if (new URL(href, window.location.href).hostname === websiteHost) {
            trackContactAction(table, id, "website_click", "detail");
          }
        } catch {
          // Not a URL.
        }
      }
    }

    function onShare() {
      trackContactAction(table, id, "share", "detail");
    }

    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener(CONTENT_SHARED_EVENT, onShare);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener(CONTENT_SHARED_EVENT, onShare);
    };
  }, [table, id, website]);

  return null;
}
