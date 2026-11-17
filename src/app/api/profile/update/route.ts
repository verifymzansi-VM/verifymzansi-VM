import type { NextRequest } from "next/server";
import { handleRestoredProfileUpdate } from "@/lib/foundation/restored-profile-route";

export async function POST(request: NextRequest) {
  return handleRestoredProfileUpdate(request);
}
