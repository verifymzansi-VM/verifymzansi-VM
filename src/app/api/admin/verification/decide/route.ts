import { NextRequest } from "next/server";
import { handleRestoredIdentityDecision } from "@/lib/foundation/restored-identity-decision-route";

/**
 * POST /api/admin/verification/decide
 *
 * Decide a KYC verification step (approve / reject / needs_resubmission).
 * Approving a high- or critical-risk step is an override: it is proposed
 * here and applied only when another governor or admin approves it on the
 * escalations page. Nobody decides their own verification.
 */
export async function POST(request: Request) {
  return handleRestoredIdentityDecision(new NextRequest(request));
}
