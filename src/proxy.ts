import type { NextRequest } from "next/server";
import { proxy as handleProxy } from "@/proxy-handler";

export function proxy(request: NextRequest) {
  return handleProxy(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/webhooks).*)"],
};
