import type { NextRequest } from "next/server";
import { handleFoundationEmailChange } from "@/app/api/foundation/auth/_lib/email-change";

/** POST /api/account/email/change — the restored profile page's email change. */
export async function POST(request: NextRequest) {
  return handleFoundationEmailChange(request);
}
