import type { NextRequest } from "next/server";
import { proxy as handleProxy, config } from "@/proxy-handler";

export function proxy(request: NextRequest) {
  return handleProxy(request);
}

export { config };
