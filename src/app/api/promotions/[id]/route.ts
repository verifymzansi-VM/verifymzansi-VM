import type { NextRequest } from "next/server";
import {
  handleRestoredPostMutation,
  handleRestoredPostRead,
} from "@/lib/foundation/restored-post-route";

/**
 * GET /api/promotions/[id]
 *
 * Get a single promotion by ID. Public for live promotions.
 * Increments view_count.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRestoredPostRead(request, "promotions", (await params).id);
}

/**
 * PUT /api/promotions/[id]
 *
 * Update a promotion. Requires authentication and ownership.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRestoredPostMutation(request, "promotions", (await params).id);
}
