import { type NextRequest } from "next/server";
import { handleRestoredVerification } from "@/lib/foundation/restored-verification-route";

export async function GET(request: NextRequest) {
  return handleRestoredVerification(request);
}
