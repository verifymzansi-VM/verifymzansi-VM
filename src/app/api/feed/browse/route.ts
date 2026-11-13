import { NextResponse, type NextRequest } from "next/server";
import { feedError, openFeedRequest, PRIVATE_NO_STORE } from "@/app/api/feed/_lib/feed-request";
import { parseBrowse } from "@/lib/feed/browse";
import { foundationBrowseSequence } from "@/lib/foundation/feed-read";
import { encodeRef } from "@/lib/feed/refs";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("FeedBrowseRoute");

/**
 * GET /api/feed/browse?v=tourism&province=Gauteng&kind=events
 * The posts the viewer's top bar asked for (section, province, filters), as
 * references in their frozen order. Slides are loaded separately.
 */
export async function GET(request: NextRequest) {
  const browse = parseBrowse(request.nextUrl.searchParams);
  if (!browse) return feedError(400, "Invalid filters");

  const limited = openFeedRequest(request, "feed:browse", 30);
  if (limited) return limited;

  try {
    const sequence = await foundationBrowseSequence(browse);
    return NextResponse.json(
      {
        v: 1,
        refs: sequence.refs.map(encodeRef),
        terminal: sequence.exhausted ? "exhausted" : "session_limit",
      },
      { headers: PRIVATE_NO_STORE }
    );
  } catch (error) {
    log.error("Browse sequence failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return feedError(500, "Could not load posts");
  }
}
