import type { NextRequest } from "next/server";
import { middleware as handleMiddleware } from "@/proxy-handler";

export function middleware(request: NextRequest) {
  return handleMiddleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/webhooks).*)"],
};
