"use client";

import { useEffect } from "react";
import {
  trackCommercialEvents,
  type CommercialEventTable,
  type CommercialEventType,
} from "@/lib/analytics/commercial-events";

/** Records that a set of items was shown on a surface (deduplicated server-side hourly). */
export function AnalyticsImpressions({
  items,
  type = "impression",
  surface,
}: {
  items: ReadonlyArray<{ table: CommercialEventTable; id: string }>;
  type?: CommercialEventType;
  surface?: string;
}) {
  const key = items.map((item) => item.id).join(",");

  useEffect(() => {
    if (!key) return;
    trackCommercialEvents(items.map((item) => ({ ...item, type, surface })));
    // Items are identified by `key`; re-run only when the set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, type, surface]);

  return null;
}
