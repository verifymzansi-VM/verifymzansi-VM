import type { NextRequest } from "next/server";
import { POST as foundationLogin } from "@/app/api/foundation/auth/login/route";

export async function POST(request: NextRequest) {
  return foundationLogin(request);
}
