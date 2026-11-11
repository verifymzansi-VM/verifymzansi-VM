import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
import type { NextRequest } from "next/server";

/**
 * POST /api/billing/change-plan
 * Retired with the fixed-term slot model (2026-09): plans no longer change
 * tier, so the shared billing handler answers stale clients with a 410.
 */
export async function POST(request: NextRequest) {
  return handleFoundationBillingRoute(request, "retired");
}
