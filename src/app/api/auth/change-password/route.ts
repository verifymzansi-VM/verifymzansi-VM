import type { NextRequest } from "next/server";
import { handleFoundationPasswordChange } from "@/app/api/foundation/auth/_lib/password-change";

export async function POST(request: NextRequest) {
  return handleFoundationPasswordChange(request);
}
