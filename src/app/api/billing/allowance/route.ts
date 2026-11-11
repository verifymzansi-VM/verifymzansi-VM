import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
import type { NextRequest } from "next/server";

/**
 * GET /api/billing/allowance?area=MZANSI_MARKET
 * The signed-in member's active slot capacity and usage in one area, for the
 * posting UI. Informational only: create routes re-check on the server.
 */
export async function GET(request: NextRequest) {
  return handleFoundationBillingRoute(request, "allowance");
}
