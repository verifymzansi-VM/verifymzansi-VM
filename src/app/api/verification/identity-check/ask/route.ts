import { type NextRequest } from "next/server";
import { handleIdentityCheckAsk } from "@/lib/foundation/identity-check";

/** POST /api/verification/identity-check/ask: asks a person to look again at
 * a declined automatic check, within 5 days of the decline. */
export async function POST(request: NextRequest) {
  return handleIdentityCheckAsk(request);
}
