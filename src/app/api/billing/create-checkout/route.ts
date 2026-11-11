import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
import type { NextRequest } from "next/server";

/**
 * POST /api/billing/create-checkout
 *
 * Create a payment checkout session and return the redirect URL.
 * Requires an authenticated user with an account profile.
 */
export async function POST(request: NextRequest) {
  return handleFoundationBillingRoute(request, "checkout");
}
