import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import { isAutomatedUserAgent } from "@/lib/analytics/automated-agent";
import { ENGAGEMENT_VIEWER_COOKIE } from "@/lib/engagement";
import {
  issueViewerToken,
  readViewerToken,
  VIEWER_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/engagement-cookie";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";

/**
 * Shared request rules of the view, like and identifier routes
 * (src/app/api/engagement/).
 *
 * The browser identifier is a random UUID in the first-party, HttpOnly cookie
 * `vmz_viewer` (one year), signed by this website (src/lib/engagement-cookie.ts)
 * so only identifiers it issued count. Only the identifier route issues it,
 * after a Turnstile check and within a per-address limit; never a page load.
 * The database stores only keyed one-way hashes of the identifier
 * (20261119172135_post_views_and_likes.sql); no network address, user agent or
 * other device detail is sent to it.
 */

/** The browser identifier of a cookie this website signed, with its issue
 * time, or null. */
export function readViewerId(request: Pick<NextRequest, "cookies">) {
  return readViewerToken(request.cookies.get(ENGAGEMENT_VIEWER_COOKIE)?.value);
}

/**
 * The limiter key of a client for every view, like and issuing limit: its
 * IPv4 address, or the /48 network of its IPv6 address (clientNetworkKey,
 * shared with sign-up).
 */
export { clientNetworkKey as engagementClientKey } from "@/lib/utils/client-network-key";

/** Sets a new signed identifier on `response`; returns it, or null without the
 * signing secret. Call only after the Turnstile check and the issuing limit. */
export async function setNewViewerId(response: NextResponse) {
  const token = await issueViewerToken();
  if (!token) return null;
  response.cookies.set({
    name: ENGAGEMENT_VIEWER_COOKIE,
    value: token.value,
    maxAge: VIEWER_COOKIE_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return token.id;
}

/**
 * Whether a request may count: not from a crawler, link previewer or headless
 * browser (isAutomatedUserAgent), and not a prefetch or prerender.
 */
export function isCountableRequest(request: Pick<Request, "headers">): boolean {
  if (isAutomatedUserAgent(request.headers.get("user-agent"))) return false;
  const purpose = [
    request.headers.get("sec-purpose"),
    request.headers.get("purpose"),
    request.headers.get("x-purpose"),
    request.headers.get("x-moz"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/prefetch|prerender|preview/.test(purpose)) return false;
  if (request.headers.get("next-router-prefetch")) return false;
  return true;
}

/**
 * The GoTrue-verified account of the request, or null for a signed-out
 * visitor or when the session cannot be checked (a view or like then counts
 * as signed out; it never guesses an identity or fails because of it).
 * `respond` passes refreshed session cookies on to the response.
 */
export async function engagementCaller(request: NextRequest) {
  let context: ReturnType<typeof createFoundationRouteContext> | null = null;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch {
    return { account: null, respond: async <T>(response: NextResponse<T>) => response };
  }
  let account: string | null = null;
  try {
    account = (await context.authenticateCaller()).accountId;
  } catch {
    // No, expired or uncheckable session (FoundationSessionError or an
    // outage): signed out.
    account = null;
  }
  return { account, respond: context.respond };
}
