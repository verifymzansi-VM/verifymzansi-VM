import type { NextRequest } from "next/server";
import {
  handleRestoredPostMutation,
  handleRestoredPostRead,
} from "@/lib/foundation/restored-post-route";

/**
 * GET /api/listings/[id]
 * The owner's own listing for the edit form, including the private street
 * address the public can't read. Everyone else gets 404.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRestoredPostRead(request, "listings", (await params).id);
}

/**
 * PUT /api/listings/[id]
 *
 * Server-side listing update with full validation, auth, ownership check,
 * and photo/video limit enforcement.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRestoredPostMutation(request, "listings", (await params).id);
}
