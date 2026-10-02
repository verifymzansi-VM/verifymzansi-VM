"use client";

import { useEffect } from "react";
import { capturePendingSource, IMMERSIVE_MIN_WIDTH_QUERY } from "@/lib/feed/session";

/**
 * On desktop, remembers which list a post card was clicked in (and the cards
 * around it, in the order they were shown) so the post viewer can continue
 * through the same list. Cards stay ordinary links; nothing is rewritten.
 * Modified clicks (new tab, new window) are left alone.
 */
export function FeedSourceCapture() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!window.matchMedia(IMMERSIVE_MIN_WIDTH_QUERY).matches) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;
      try {
        capturePendingSource(anchor);
      } catch {
        // Never block a navigation over analytics-grade convenience.
      }
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}
