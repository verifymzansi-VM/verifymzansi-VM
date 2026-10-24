import type { NextRequest } from "next/server";
import { handleFoundationPhoneRoute } from "../_lib/handle";

export function POST(request: NextRequest) {
  return handleFoundationPhoneRoute(request, "send");
}
