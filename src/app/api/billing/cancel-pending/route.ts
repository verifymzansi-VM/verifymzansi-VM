import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return handleFoundationBillingRoute(request, "cancel-pending");
}
