import { decodeRef, encodeRef } from "@/lib/feed/refs";
import type { FeedRef, FeedSlide } from "@/lib/feed/types";

/**
 * Public slides for up to four posts (both viewers). A post the server leaves
 * out, or returns as null, is no longer public and comes back as null.
 */
export async function fetchSlides(
  batch: FeedRef[],
  signal: AbortSignal
): Promise<Map<string, FeedSlide | null>> {
  const response = await fetch(
    `/api/feed/slides?refs=${encodeURIComponent(batch.map(encodeRef).join(","))}`,
    { cache: "no-store", signal, credentials: "same-origin" }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as { slides: { ref: string; slide: FeedSlide | null }[] };
  const loaded = new Map<string, FeedSlide | null>();
  for (const entry of payload.slides) {
    const ref = decodeRef(entry.ref.replace(":", "."));
    if (ref) loaded.set(ref.id, entry.slide);
  }
  for (const ref of batch) if (!loaded.has(ref.id)) loaded.set(ref.id, null);
  return loaded;
}

/** Add newly loaded slides without replacing ones already shown. */
export function mergeSlides(
  current: Map<string, FeedSlide | null>,
  loaded: Map<string, FeedSlide | null>,
  accept: (slide: FeedSlide | null) => FeedSlide | null = (slide) => slide
) {
  const next = new Map(current);
  for (const [id, slide] of loaded) if (!next.has(id)) next.set(id, accept(slide));
  return next;
}

export function withoutRefs(current: Set<string>, batch: FeedRef[]) {
  const next = new Set(current);
  batch.forEach((ref) => next.delete(ref.id));
  return next;
}
