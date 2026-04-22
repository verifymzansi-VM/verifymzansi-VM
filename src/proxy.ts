import type { NextRequest } from "next/server";
import { handleMiddlewareRequest } from "@/proxy-handler";

export async function proxy(request: NextRequest) {
  return handleMiddlewareRequest(request);
}
