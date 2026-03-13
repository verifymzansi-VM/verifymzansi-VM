import "server-only";

import { NextResponse } from "next/server";
import type { Logger } from "@/lib/utils/logger";
import { resolveAppOrigin } from "@/lib/utils/auth-redirect";

interface RequestLike {
  headers: Headers;
  url: string;
  nextUrl?: {
    pathname: string;
  };
}

type SameOriginDecision =
  | { allowed: true; reason: "same-origin" | "same-site-fetch" | "non-browser" | "browser-none" }
  | {
      allowed: false;
      status: number;
      error: string;
      reason: "invalid-origin" | "cross-site-origin" | "cross-site-fetch";
    };

function safeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;

  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function evaluateSameOriginMutation(request: RequestLike): SameOriginDecision {
  const origin = request.headers.get("origin");
  const secFetchSite = request.headers.get("sec-fetch-site");
  const canonicalOrigin = safeOrigin(resolveAppOrigin({ url: request.url }));
  const requestOrigin = safeOrigin(request.url);

  if (origin) {
    const normalizedOrigin = safeOrigin(origin);

    if (!normalizedOrigin) {
      return {
        allowed: false,
        status: 403,
        error: "Invalid request origin",
        reason: "invalid-origin",
      };
    }

    if (normalizedOrigin === canonicalOrigin || normalizedOrigin === requestOrigin) {
      return { allowed: true, reason: "same-origin" };
    }

    return {
      allowed: false,
      status: 403,
      error: "Cross-site requests are not allowed",
      reason: "cross-site-origin",
    };
  }

  if (!secFetchSite) {
    // Non-browser or same-process callers often omit browser fetch metadata.
    return { allowed: true, reason: "non-browser" };
  }

  if (secFetchSite === "same-origin" || secFetchSite === "same-site") {
    return { allowed: true, reason: "same-site-fetch" };
  }

  if (secFetchSite === "none") {
    return { allowed: true, reason: "browser-none" };
  }

  return {
    allowed: false,
    status: 403,
    error: "Cross-site requests are not allowed",
    reason: "cross-site-fetch",
  };
}

export function enforceSameOriginMutation(
  request: RequestLike,
  log?: Pick<Logger, "warn">
): NextResponse | null {
  const decision = evaluateSameOriginMutation(request);

  if (decision.allowed) {
    return null;
  }

  log?.warn("Rejected state-changing request with invalid origin", {
    path: request.nextUrl?.pathname ?? new URL(request.url).pathname,
    reason: decision.reason,
    origin: request.headers.get("origin") ?? undefined,
    secFetchSite: request.headers.get("sec-fetch-site") ?? undefined,
  });

  return NextResponse.json({ error: decision.error }, { status: decision.status });
}
