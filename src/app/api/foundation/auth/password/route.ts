import type { NextRequest } from "next/server";
import { handleFoundationPasswordChange } from "../_lib/password-change";

export function POST(request: NextRequest) {
  return handleFoundationPasswordChange(request);
}
