import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return handleFoundationBillingRoute(request, "payment-status");
}
