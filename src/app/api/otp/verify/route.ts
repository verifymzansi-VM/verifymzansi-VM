import type { NextRequest } from "next/server";
import { handleFoundationPhoneRoute } from "@/app/api/foundation/phone/_lib/handle";

export async function POST(request: NextRequest) {
  return handleFoundationPhoneRoute(request, "verify", true);
}
