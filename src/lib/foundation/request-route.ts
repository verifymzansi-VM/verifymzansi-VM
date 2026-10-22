import "server-only";

import type { CookieMethodsServer } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { parseFoundationConnection } from "./connection";
import { createFoundationRequestCaller } from "./request-api";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";

/** Route handlers must still enforce origin/CSRF and validate each command.
 * Return every success/error response through respond() so refreshed or cleared
 * cookies and private cache headers survive. Construct once per incoming request;
 * never cache this context or its authenticated API between requests.
 */
export function createFoundationRouteContext(
  input: unknown,
  request: Pick<NextRequest, "cookies">,
  fetcher: typeof fetch = createTimeoutFetch()
) {
  const config = parseFoundationConnection(input);
  const values = new Map(request.cookies.getAll().map(({ name, value }) => [name, value]));
  const writes: Parameters<NonNullable<CookieMethodsServer["setAll"]>>[0] = [];
  let authenticated: ReturnType<typeof createFoundationRequestCaller> | undefined;
  let api: Promise<Awaited<ReturnType<typeof createFoundationRequestCaller>>["api"]> | undefined;
  const verify = () =>
    (authenticated ??= createFoundationRequestCaller(
      config,
      {
        getAll: () => [...values].map(([name, value]) => ({ name, value })),
        setAll: (items) => {
          for (const item of items) values.set(item.name, item.value);
          writes.push(...items);
        },
      },
      fetcher
    ));
  return Object.freeze({
    authenticate() {
      return (api ??= verify().then((caller) => caller.api));
    },
    /** The verified caller's API plus account id, for trusted server commands. */
    authenticateCaller() {
      return verify();
    },
    async respond<T>(response: NextResponse<T>): Promise<NextResponse<T>> {
      // A failed refresh can clear cookies too. Wait for its writes even when
      // the route is returning its own authentication-error response.
      await authenticated?.catch(() => {});
      for (const { name, value, options } of writes) response.cookies.set(name, value, options);
      response.headers.set(
        "Cache-Control",
        "private, no-cache, no-store, must-revalidate, max-age=0"
      );
      response.headers.set("CDN-Cache-Control", "no-store");
      response.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
      response.headers.set("Expires", "0");
      response.headers.set("Pragma", "no-cache");
      return response;
    },
  });
}
