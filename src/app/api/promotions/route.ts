import { restoredMarketplaceResponse } from "@/lib/foundation/marketplace-route";
import { handleRestoredPostMutation } from "@/lib/foundation/restored-post-route";
import type { NextRequest } from "next/server";

/**
 * POST /api/promotions
 *
 * Create a new standalone promotion / advertisement.
 * Requires an authenticated, verified account with a valid entitlement or free post.
 */
export async function POST(request: NextRequest) {
  return handleRestoredPostMutation(request, "promotions");
}

/**
 * GET /api/promotions
 *
 * List live promotions with optional filters.
 * Public endpoint — no auth required.
 */
export async function GET(request: NextRequest) {
  return restoredMarketplaceResponse(request, "promotions");
}
