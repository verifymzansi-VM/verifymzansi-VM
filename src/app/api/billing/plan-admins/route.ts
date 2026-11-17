import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
import type { NextRequest } from "next/server";

/**
 * POST /api/billing/plan-admins
 * The buyer of a multi-listing plan adds or removes its second named
 * administrator (an identity-reviewed account). The database checks that the
 * caller bought this plan and enforces the two-administrator limit.
 */
export async function POST(request: NextRequest) {
  return handleFoundationBillingRoute(request, "manage-member");
}
