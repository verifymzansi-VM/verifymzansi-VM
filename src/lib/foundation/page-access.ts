import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { CookieMethodsServer } from "@supabase/ssr";
import { createFoundationRequestCaller, FoundationSessionError } from "./request-api";
import { readFoundationAccountContext, FoundationAccountContextError } from "./account-context";
import { readFoundationRuntimeConnection } from "./runtime-connection";
import { FOUNDATION_POST_SIGNUP_PATH } from "./auth-navigation";

function under(path: string, prefix: string) {
  return path === prefix || path.startsWith(prefix + "/");
}

/** Routing hints only; page layouts and every API command still authorize their
 * own operations. Uses the verified London caller and live canonical account,
 * never source tables, JWT role metadata or a phone-gate cookie. */
export async function checkFoundationPageAccess(request: NextRequest, authPage: boolean) {
  const path = request.nextUrl.pathname;
  const apiRequest = path.startsWith("/api/");
  const pending: Parameters<NonNullable<CookieMethodsServer["setAll"]>>[0] = [];
  const reply = (response: NextResponse) => {
    for (const { name, value, options } of pending) response.cookies.set(name, value, options);
    response.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
    response.headers.set("CDN-Cache-Control", "no-store");
    response.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
    return response;
  };
  const next = () => NextResponse.next({ request: { headers: request.headers } });
  const redirect = (pathname: string) =>
    reply(NextResponse.redirect(new URL(pathname, request.url)));
  const refuse = (status: number, error: string) => reply(NextResponse.json({ error }, { status }));
  try {
    const caller = await createFoundationRequestCaller(readFoundationRuntimeConnection(), {
      getAll: () => request.cookies.getAll(),
      setAll(items) {
        for (const item of items) {
          // Refresh the downstream request too, avoiding another refresh using
          // stale incoming chunks in the Server Component or route handler.
          request.cookies.set(item.name, item.value);
          pending.push(item);
        }
      },
    });
    const account = await readFoundationAccountContext(caller.api);
    if (account.account_id !== caller.accountId)
      throw new FoundationAccountContextError("unavailable");
    if (authPage) return redirect(account.phone ? "/dashboard" : FOUNDATION_POST_SIGNUP_PATH);

    const staffPath = ["/admin", "/api/admin", "/staff"].some((prefix) => under(path, prefix));
    if (staffPath) {
      if (!account.staff) return apiRequest ? refuse(403, "Forbidden") : redirect("/dashboard");
      if (path !== "/staff/two-step" && !account.staff.can_access) {
        if (apiRequest) return refuse(403, "Two-step verification required");
        const url = new URL("/staff/two-step", request.url);
        if (under(path, "/admin")) url.searchParams.set("next", path + request.nextUrl.search);
        return reply(NextResponse.redirect(url));
      }
    }

    const phonePath = ["/dashboard", "/post", "/billing", "/verification"].some((prefix) =>
      under(path, prefix)
    );
    if (!apiRequest && phonePath && path !== FOUNDATION_POST_SIGNUP_PATH && !account.phone) {
      const url = new URL(FOUNDATION_POST_SIGNUP_PATH, request.url);
      url.searchParams.set("returnUrl", path + request.nextUrl.search);
      return reply(NextResponse.redirect(url));
    }
    return reply(next());
  } catch (error) {
    if (error instanceof FoundationSessionError && error.status === 401) {
      if (authPage) return reply(next());
      if (apiRequest) return refuse(401, "Unauthorized");
      const url = new URL("/login", request.url);
      url.searchParams.set("returnUrl", path + request.nextUrl.search);
      return reply(NextResponse.redirect(url));
    }
    if (error instanceof FoundationAccountContextError && error.reason === "forbidden")
      return apiRequest ? refuse(403, "Forbidden") : redirect("/error?reason=forbidden");
    // An unavailable or malformed context must never enter protected content.
    return apiRequest
      ? refuse(503, "Authentication unavailable")
      : redirect("/error?reason=unavailable");
  }
}
