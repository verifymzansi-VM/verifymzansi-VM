import type { NextRequest } from "next/server";
import { handlePostCopy } from "@/lib/foundation/post-copy";

/**
 * POST /api/listings/[id]/copy
 *
 * Copy a post (Multi-listing package): a new draft from one of the caller's
 * own Market listings, opened in the "Post an item" form.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handlePostCopy(request, (await params).id);
}
