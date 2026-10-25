import type { NextRequest } from "next/server";
import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
export function GET(request: NextRequest) {
  return handleFoundationBillingRoute(request, "overview");
}
