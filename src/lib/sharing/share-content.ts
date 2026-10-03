import type { ContentTargetType } from "@/lib/engagement";
import { CONTENT_SHARED_EVENT } from "@/lib/analytics/commercial-events";

const TABLES = { listing: "listings", business: "businesses", promotion: "promotions" } as const;
/** Sharing still succeeds if metrics are temporarily unavailable. Cancellation does nothing. */
export async function shareContent({
  title,
  path,
  targetId,
  targetType,
  recordMetrics = true,
}: {
  title: string;
  path: string;
  targetId: string;
  targetType: ContentTargetType;
  recordMetrics?: boolean;
}): Promise<{ method: "native" | "copy"; shareCount?: number } | null> {
  const canonical = new URL(path, window.location.origin);
  if (canonical.origin !== window.location.origin) throw new Error("Invalid page address");
  canonical.search = "";
  canonical.hash = "";
  let method: "native" | "copy" = "copy";
  if (navigator.share) {
    try {
      await navigator.share({ title, url: canonical.href });
      method = "native";
    } catch (error) {
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError")
        return null;
    }
  }
  if (method === "copy") await navigator.clipboard.writeText(canonical.href);
  if (recordMetrics)
    window.dispatchEvent(
      new CustomEvent(CONTENT_SHARED_EVENT, { detail: { table: TABLES[targetType], id: targetId } })
    );
  let shareCount: number | undefined;
  if (recordMetrics && navigator.doNotTrack !== "1") {
    try {
      const response = await fetch("/api/engagement/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({ targetId, targetType }),
      });
      const payload = await response.json();
      if (response.ok && typeof payload.shareCount === "number") shareCount = payload.shareCount;
    } catch {
      /* Keep the successful share when metrics fail. */
    }
  }
  return { method, shareCount };
}
