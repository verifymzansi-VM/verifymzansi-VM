import type { NextRequest } from "next/server";

function isLocalHost(hostname: string | null | undefined): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function isStrictLocalDevelopmentRequest(
  request: Pick<NextRequest, "nextUrl" | "headers">
): boolean {
  if (process.env.NODE_ENV !== "development") {
    return false;
  }

  if (!isLocalHost(request.nextUrl?.hostname)) {
    return false;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  try {
    return isLocalHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}
