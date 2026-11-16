import { restoredMarketplaceResponse } from "@/lib/foundation/marketplace-route";
import { handleRestoredPostMutation } from "@/lib/foundation/restored-post-route";
import type { NextRequest } from "next/server";

/**
 * POST /api/businesses
 *
 * Create a new Mzansi Business listing.
 * Requires an authenticated, verified account.
 */
export async function POST(request: NextRequest) {
  return handleRestoredPostMutation(request, "businesses");
}

/**
 * GET /api/businesses
 *
 * List live businesses with optional filters.
 * Public endpoint — no auth required.
 * Supports ?categories_only=true to return just category counts for auto-hide.
 */
export async function GET(request: NextRequest) {
  return restoredMarketplaceResponse(request, "businesses");
}
