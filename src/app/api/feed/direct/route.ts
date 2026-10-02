import { NextResponse, type NextRequest } from "next/server";
import { feedError, openFeedRequest, PRIVATE_NO_STORE } from "@/app/api/feed/_lib/feed-request";
import { buildDirectSequence } from "@/lib/feed/direct-sequence";
import { decodeRef, encodeRef } from "@/lib/feed/refs";
import { getVisitorProvince } from "@/lib/showroom/visitor-province";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("FeedDirectRoute");

/**
 * GET /api/feed/direct?ref=l.<id>
 * The order to continue in after a post opened without a list (shared link,
 * search engine, a rail that ran out): same category, local first, then the
 * whole vertical. References only; slides are loaded separately.
 */
export async function GET(request: NextRequest) {
  const ref = decodeRef(request.nextUrl.searchParams.get("ref") ?? "");
  if (!ref) return feedError(400, "Invalid ref");

  const opened = await openFeedRequest(request, "feed:direct", 30);
  if (opened.response) return opened.response;

  try {
    const { province } = await getVisitorProvince();
    const sequence = await buildDirectSequence(opened.supabase, ref, province);
    if (!sequence) return feedError(404, "Post not found");
    return NextResponse.json(
      {
        v: 1,
        refs: sequence.refs.map(encodeRef),
        terminal: sequence.exhausted ? "exhausted" : "source_limit",
      },
      { headers: PRIVATE_NO_STORE }
    );
  } catch (error) {
    log.error("Direct sequence failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return feedError(500, "Could not load recommendations");
  }
}
