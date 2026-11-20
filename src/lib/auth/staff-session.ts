import "server-only";
import { NextResponse } from "next/server";
import { parseCookieHeader } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import type { FoundationAuthenticatedApi } from "@/lib/foundation/authenticated-api";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { unauthorizedResponse } from "@/lib/utils/api";

type StaffRouteContext = ReturnType<typeof createFoundationRouteContext>;
type RouteCookies = Parameters<typeof createFoundationRouteContext>[1];

/** A Next.js request's cookies, or the Cookie header of a plain Request. The
 * request body is never read, so the route can still parse it afterwards. */
function cookiesOf(request: Request): RouteCookies {
  const own = (request as Partial<RouteCookies>).cookies;
  if (own && typeof own.getAll === "function") return { cookies: own };
  const all = parseCookieHeader(request.headers.get("cookie") ?? "").map(({ name, value }) => ({
    name,
    value: value ?? "",
  }));
  return { cookies: { getAll: () => all } } as unknown as RouteCookies;
}

/** The verified caller of a staff API request on the live backend. */
export interface StaffRequestCaller {
  api: FoundationAuthenticatedApi;
  accountId: string;
  user: User;
  /** When this session last used its authenticator app (seconds), or null. */
  authenticatorAt: number | null;
}

export type StaffRequestSession =
  | { ok: true; caller: StaffRequestCaller; respond: StaffRouteContext["respond"] }
  | { ok: false; response: NextResponse };

const unavailable = () =>
  NextResponse.json(
    { error: "The service is temporarily unavailable. Please try again." },
    { status: 503 }
  );

/**
 * Resolve the signed-in caller of a staff API request. Auth verifies the exact
 * session token, so a signed-out, revoked or forged session is refused here
 * (401). A signed JWT can outlive sign-out, factor removal or a downgrade, so
 * staff authority is never read from its claims: the account context command
 * (admin-access.ts) checks the live session, account, factor and role in the
 * database. Any other failure refuses the request (fail closed, 503).
 *
 * Send every response through `respond`, so refreshed session cookies and the
 * private cache headers reach the browser.
 */
export async function authenticateStaffRequest(request: Request): Promise<StaffRequestSession> {
  let context: StaffRouteContext;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), cookiesOf(request));
  } catch {
    return { ok: false, response: unavailable() };
  }
  try {
    const verified = await context.authenticateCaller();
    if (verified.user.id !== verified.accountId)
      return { ok: false, response: await context.respond(unauthorizedResponse()) };
    return {
      ok: true,
      respond: context.respond,
      caller: {
        api: verified.api,
        accountId: verified.accountId,
        user: verified.user,
        authenticatorAt: verified.authenticatorAt,
      },
    };
  } catch (error) {
    const response =
      error instanceof FoundationSessionError && error.status === 401
        ? unauthorizedResponse()
        : unavailable();
    return { ok: false, response: await context.respond(response) };
  }
}
