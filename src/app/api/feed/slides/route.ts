import { NextResponse, type NextRequest } from "next/server";
import { feedError, openFeedRequest, PRIVATE_NO_STORE } from "@/app/api/feed/_lib/feed-request";
import { loadFeedSlides } from "@/lib/feed/load-slides";
import { decodeRef, refKey } from "@/lib/feed/refs";
import type { FeedRef } from "@/lib/feed/types";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("FeedSlidesRoute");
const MAX_REFS = 4;

/**
 * GET /api/feed/slides?refs=l.<id>,t.<id>
 * Public slides for up to four posts. A post that is no longer public comes
 * back as null so the viewer skips it without ending the feed.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("refs") ?? "";
  const parts = raw.split(",").filter(Boolean);
  const refs = parts.map(decodeRef);
  if (parts.length === 0 || parts.length > MAX_REFS || refs.some((ref) => !ref)) {
    return feedError(400, "Invalid refs");
  }

  const opened = await openFeedRequest(request, "feed:slides", 120);
  if (opened.response) return opened.response;

  try {
    const slides = await loadFeedSlides(opened, refs as FeedRef[]);
    return NextResponse.json(
      {
        v: 1,
        slides: (refs as FeedRef[]).map((ref) => ({
          ref: refKey(ref),
          slide: slides.get(refKey(ref)) ?? null,
        })),
      },
      { headers: PRIVATE_NO_STORE }
    );
  } catch (error) {
    log.error("Slide load failed", { error: error instanceof Error ? error.message : "unknown" });
    return feedError(500, "Could not load posts");
  }
}
