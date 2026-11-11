import type { NextRequest } from "next/server";
import { handleFoundationGoogleOAuth } from "@/app/api/foundation/auth/_lib/google-oauth";

export async function POST(request: NextRequest) {
  return handleFoundationGoogleOAuth(request);
}
