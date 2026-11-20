import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
import type { NextRequest } from "next/server";

/**
 * POST /api/billing/package-add-checkout
 *
 * Start the Ozow payment for slots added to the member's running
 * Multi-listing package (roadmap P4b) and return the redirect URL. Only while
 * packages are on sale; the database prices the days left and applies every
 * rule again.
 */
export async function POST(request: NextRequest) {
  return handleFoundationBillingRoute(request, "package-add-checkout");
}
