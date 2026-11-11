import type { NextRequest } from "next/server";
import { POST as requestRecovery } from "@/app/api/foundation/auth/recovery/request/route";

export async function POST(request: NextRequest) {
  return requestRecovery(request);
}
