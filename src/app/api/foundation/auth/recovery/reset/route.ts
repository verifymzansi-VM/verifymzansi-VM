import type { NextRequest } from "next/server";
import { handleFoundationRecoveryCompletion } from "../../_lib/recovery-complete";
export function GET(request: NextRequest) {
  return handleFoundationRecoveryCompletion(request, false);
}
export function POST(request: NextRequest) {
  return handleFoundationRecoveryCompletion(request, true);
}
