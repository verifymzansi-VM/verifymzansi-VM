import type { NextRequest } from "next/server";
import { handleMiddlewareRequest } from "@/proxy-handler";

export async function middleware(request: NextRequest) {
  return handleMiddlewareRequest(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/webhooks).*)"],
};
