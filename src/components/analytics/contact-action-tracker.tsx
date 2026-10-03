"use client";

import { useEffect, type RefObject } from "react";
import { useClassicSuppressed } from "@/components/immersive/classic-suppression";
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
 *
 * The desktop viewer runs exactly one tracker, for the post on screen, scoped
 * to that post's slide (`root`) so a click is never credited to two posts.
 */
export function ContactActionTracker({
  table,
  id,
  website,
  enabled = true,
  root,
  surface = "detail",
}: {
  table: CommercialEventTable;
  id: string | null | undefined;
  website?: string | null;
  enabled?: boolean;
  root?: RefObject<HTMLElement | null>;
  surface?: string;
}) {
  const isSuppressed = useClassicSuppressed();

  useEffect(() => {
    if (!id || !enabled || (!root && isSuppressed())) return;
    trackCommercialEvents([{ table, id, type: "detail_view", surface }]);

    let websiteHost: string | null = null;
    try {
      websiteHost = website ? new URL(website).hostname : null;
    } catch {
      websiteHost = null;
    }

    function onClick(event: MouseEvent) {
      const target = event.target as Element | null;
      if (root && !(target instanceof Node && root.current?.contains(target))) return;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      const action = anchor.dataset.contactAction;
      if (
        action === "directions_click" ||
        action === "booking_click" ||
        action === "ticket_click"
      ) {
        trackContactAction(table, id!, action, surface);
      } else if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(href)) {
        trackContactAction(table, id!, "whatsapp_click", surface);
      } else if (href.startsWith("tel:")) {
        trackContactAction(table, id!, "phone_click", surface);
      } else if (websiteHost) {
        try {
          if (new URL(href, window.location.href).hostname === websiteHost) {
            trackContactAction(table, id!, "website_click", surface);
          }
        } catch {
          // Not a URL.
        }
      }
    }

    function onShare(event: Event) {
      const detail = (event as CustomEvent<{ table: string; id: string }>).detail;
      if (detail && (detail.table !== table || detail.id !== id)) return;
      trackContactAction(table, id!, "share", surface);
    }

    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener(CONTENT_SHARED_EVENT, onShare);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener(CONTENT_SHARED_EVENT, onShare);
    };
  }, [table, id, website, enabled, root, surface, isSuppressed]);

  return null;
}
