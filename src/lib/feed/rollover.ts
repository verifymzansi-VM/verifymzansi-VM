import { defaultBrowse, type FeedBrowse } from "@/lib/feed/browse";
import type { FeedVertical } from "@/lib/feed/types";

/**
 * When an area's posts run out, Video mode and the desktop post viewer carry
 * straight on into the next area, in a loop: Tourism & Events, then Business,
 * then Market, then Tourism & Events again. Going back past an area's first
 * post goes to the area before it.
 */
export const AREA_ORDER: readonly FeedVertical[] = ["tourism", "business", "market"];

/** Short names for the left column and the roll-over cue. */
export const AREA_SHORT_LABELS: Record<FeedVertical, string> = {
  tourism: "Tourism",
  business: "Business",
  market: "Market",
};

export function nextArea(vertical: FeedVertical, direction: 1 | -1 = 1): FeedVertical {
  const index = AREA_ORDER.indexOf(vertical);
  const count = AREA_ORDER.length;
  return AREA_ORDER[(index + direction + count) % count];
}

/**
 * The browse for the area rolled into. The province is the visitor's own
 * place, so it carries on; category, price, condition and stay or event type
 * belong to one area, so they reset, unless the visitor was already in that
 * area during this visit, in which case its earlier filters come back.
 */
export function rolloverBrowse(
  from: FeedBrowse,
  to: FeedVertical,
  remembered?: FeedBrowse | null
): FeedBrowse {
  if (remembered && remembered.vertical === to) return { ...remembered, province: from.province };
  return defaultBrowse(to, from.province);
}

/** "Business · KwaZulu-Natal", or "Business" for the whole country. */
export function rolloverCue(browse: FeedBrowse): string {
  const area = AREA_SHORT_LABELS[browse.vertical];
  return browse.province ? `${area} · ${browse.province}` : area;
}
