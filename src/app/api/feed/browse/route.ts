import { NextResponse, type NextRequest } from "next/server";
import { feedError, openFeedRequest, PRIVATE_NO_STORE } from "@/app/api/feed/_lib/feed-request";
import { parseBrowse } from "@/lib/feed/browse";
import { buildBrowseSequence } from "@/lib/feed/browse-sequence";
import { encodeRef } from "@/lib/feed/refs";
import { getVisitorProvince } from "@/lib/showroom/visitor-province";
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

  const opened = await openFeedRequest(request, "feed:browse", 30);
  if (opened.response) return opened.response;

  try {
    const { province } = browse.province ? { province: null } : await getVisitorProvince();
    const sequence = await buildBrowseSequence(opened.supabase, browse, province);
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
