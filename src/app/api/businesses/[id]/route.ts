import type { NextRequest } from "next/server";
import {
  handleRestoredPostMutation,
  handleRestoredPostRead,
} from "@/lib/foundation/restored-post-route";

/**
 * GET /api/businesses/[id]
 *
 * Get a single business by ID. Public for live businesses.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRestoredPostRead(request, "businesses", (await params).id);
}

/**
 * PATCH /api/businesses/[id]
 *
 * Update a business. Requires authentication and ownership.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRestoredPostMutation(request, "businesses", (await params).id);
}
