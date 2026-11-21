import { type NextRequest } from "next/server";
import {
  handleIdentityCheckAvailability,
  handleIdentityCheckStart,
} from "@/lib/foundation/identity-check";

/**
 * GET /api/verification/identity-check: where the member's ID check goes now
 * (the automatic check or photos on the page) and their latest check.
 * POST: starts or resumes the member's automatic ID check and answers its
 * session link for the frame on the verification page.
 */
export async function GET(request: NextRequest) {
  return handleIdentityCheckAvailability(request);
}

export async function POST(request: NextRequest) {
  return handleIdentityCheckStart(request);
}
