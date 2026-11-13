import { restoredMarketplaceResponse } from "@/lib/foundation/marketplace-route";
import { handleRestoredPostMutation } from "@/lib/foundation/restored-post-route";
import type { NextRequest } from "next/server";

/**
 * GET /api/listings
 *
 * Public listing discovery endpoint for Mzansi Market with filtering and pagination.
 */
export async function GET(request: NextRequest) {
  return restoredMarketplaceResponse(request, "listings");
}

/**
 * POST /api/listings
 *
 * Server-side listing creation with full validation, auth, ownership,
 * entitlement enforcement, and free-post tracking.
 */
export async function POST(request: NextRequest) {
  return handleRestoredPostMutation(request, "listings");
}
