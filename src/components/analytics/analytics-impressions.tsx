"use client";

import { useEffect, useRef } from "react";
import {
  trackCommercialEvents,
  type CommercialEventTable,
  type CommercialEventType,
} from "@/lib/analytics/commercial-events";

/** MRC/IAB viewable display impression: half the card on screen for 1 second. */
export const IMPRESSION_VISIBLE_RATIO = 0.5;
export const IMPRESSION_DWELL_MS = 1_000;

/**
 * Records that items were seen on a surface (deduplicated server-side hourly).
 * An item counts only once its card has been at least half on screen for one
 * continuous second with the tab visible, not when the page merely loads.
 * Cards are found by the link that contains the item's ID inside the section
 * this component is rendered in; an item without such a link falls back to
 * the section itself being viewable.
 */
export function AnalyticsImpressions({
  items,
  type = "impression",
  surface,
}: {
  items: ReadonlyArray<{ table: CommercialEventTable; id: string }>;
  type?: CommercialEventType;
  surface?: string;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const key = items.map((item) => `${item.table}:${item.id}`).join(",");

  useEffect(() => {
    const container = anchorRef.current?.parentElement;
    if (!key || !container) return;

    const sent = new Set<string>();
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    const itemsByElement = new Map<Element, { table: CommercialEventTable; id: string }[]>();

    for (const item of items) {
      const cards = [...container.querySelectorAll(`a[href*="${CSS.escape(item.id)}"]`)];
      for (const element of cards.length > 0 ? cards : [container]) {
        itemsByElement.set(element, [...(itemsByElement.get(element) ?? []), item]);
      }
    }

    const record = (element: Element) => {
      const fresh = (itemsByElement.get(element) ?? []).filter(
        (item) => !sent.has(`${item.table}:${item.id}`)
      );
      if (fresh.length === 0) return;
      fresh.forEach((item) => sent.add(`${item.table}:${item.id}`));
      trackCommercialEvents(fresh.map((item) => ({ ...item, type, surface })));
    };

    const cancel = (element: Element) => {
      const timer = timers.get(element);
      if (timer) clearTimeout(timer);
      timers.delete(element);
    };

    if (typeof IntersectionObserver === "undefined") {
      itemsByElement.forEach((_, element) => record(element));
      return;
    }

    const visible = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Tall sections count when they fill half the screen instead.
          const viewportShare =
            entry.rootBounds && entry.rootBounds.height > 0
              ? entry.intersectionRect.height / entry.rootBounds.height
              : 0;
          const viewable =
            entry.isIntersecting &&
            (entry.intersectionRatio >= IMPRESSION_VISIBLE_RATIO ||
              viewportShare >= IMPRESSION_VISIBLE_RATIO);
          if (viewable) {
            visible.add(entry.target);
            if (!timers.has(entry.target) && document.visibilityState !== "hidden") {
              const target = entry.target;
              timers.set(
                target,
                setTimeout(() => {
                  timers.delete(target);
                  record(target);
                }, IMPRESSION_DWELL_MS)
              );
            }
          } else {
            visible.delete(entry.target);
            cancel(entry.target);
          }
        }
      },
      { threshold: [0, 0.25, IMPRESSION_VISIBLE_RATIO, 0.75, 1] }
    );

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        [...timers.keys()].forEach(cancel);
        return;
      }
      for (const element of visible) {
        if (timers.has(element)) continue;
        timers.set(
          element,
          setTimeout(() => {
            timers.delete(element);
            record(element);
          }, IMPRESSION_DWELL_MS)
        );
      }
    };

    itemsByElement.forEach((_, element) => observer.observe(element));
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      [...timers.keys()].forEach(cancel);
    };
    // Items are identified by `key`; re-run only when the set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, type, surface]);

  return <span ref={anchorRef} hidden aria-hidden="true" />;
}
