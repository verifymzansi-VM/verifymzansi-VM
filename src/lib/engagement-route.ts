import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAutomatedUserAgent } from "@/lib/analytics/automated-agent";
import {
  createAnonymousViewerId,
  ENGAGEMENT_VIEWER_COOKIE,
  ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/engagement";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";

/**
 * Shared request rules of the view and like routes (src/app/api/engagement/).
 *
 * The browser identifier is a random UUID in the first-party, HttpOnly cookie
 * `vmz_viewer` (one year). It is issued by these routes, never by a page, and
 * the database stores only keyed one-way hashes of it
 * (20261119172135_post_views_and_likes.sql). No network address, user agent or
 * other device detail is sent to the database.
 */

const viewerId = z.uuid();

/** The browser identifier from the request's cookie, or null. */
export function readViewerId(request: Pick<NextRequest, "cookies">): string | null {
  const value = request.cookies.get(ENGAGEMENT_VIEWER_COOKIE)?.value;
  return viewerId.safeParse(value).success ? value! : null;
}

/** Issues a browser identifier (a new one unless given) on `response`;
 * returns it. */
export function issueViewerId(response: NextResponse, id = createAnonymousViewerId()): string {
  response.cookies.set({
    name: ENGAGEMENT_VIEWER_COOKIE,
    value: id,
    maxAge: ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return id;
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
