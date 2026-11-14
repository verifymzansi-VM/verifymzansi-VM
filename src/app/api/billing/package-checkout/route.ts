import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
import type { NextRequest } from "next/server";

/**
 * POST /api/billing/package-checkout
 *
 * Start the Ozow payment for a Multi-listing package (a typed number of
 * slots and a term) and return the redirect URL. Only while packages are on
 * sale; the database applies every rule again.
 */
export async function POST(request: NextRequest) {
  return handleFoundationBillingRoute(request, "package-checkout");
}
