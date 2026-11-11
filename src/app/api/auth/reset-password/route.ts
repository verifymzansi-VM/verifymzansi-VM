import type { NextRequest } from "next/server";
import { handleFoundationRecoveryCompletion } from "@/app/api/foundation/auth/_lib/recovery-complete";

/**
 * GET /api/auth/reset-password
 *
 * Check if the current session is a valid recovery session.
 */
export async function GET(request: NextRequest) {
  return handleFoundationRecoveryCompletion(request, false);
}

/**
 * POST /api/auth/reset-password
 *
 * Complete a password reset using an active recovery session.
 */
export async function POST(request: NextRequest) {
  return handleFoundationRecoveryCompletion(request, true);
}
