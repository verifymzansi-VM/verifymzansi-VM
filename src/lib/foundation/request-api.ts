import "server-only";

import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { z } from "zod";
import type { FoundationAuthenticatedDatabase } from "../../../database/foundation/api-role-types";
import { createFoundationAuthenticatedApi } from "./authenticated-api";
import { parseFoundationConnection } from "./connection";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";

type RequestCookies = Required<Pick<CookieMethodsServer, "getAll" | "setAll">>;
export class FoundationSessionError extends Error {
  constructor(readonly status: 401 | 503) {
    super("A verified foundation account session is required");
  }
}
const authFailureStatus = (error: { status?: number }): 401 | 503 =>
  [400, 401, 403, 422].includes(error.status ?? 0) ? 401 : 503;
const caller = z.object({
  iss: z.string(),
  sub: z.uuid(),
  exp: z.number().int().positive(),
});

/** One request, one explicit foundation project, one verified caller token.
 * The caller must forward BOTH cookie writes and cache headers from setAll to
 * its response before streaming. Proxy/route integration owns that response;
 * this bridge never swallows a failed cookie write or falls back to legacy Auth.
 * getSession supplies a candidate token only. GoTrue verifies that exact token;
 * SQL still enforces live session, account, MFA and command-specific authority.
 */
export async function createFoundationRequestApi(
  input: unknown,
  cookies: RequestCookies,
  fetcher: typeof fetch = createTimeoutFetch()
) {
  const config = parseFoundationConnection(input);
  if (typeof cookies?.getAll !== "function" || typeof cookies?.setAll !== "function")
    throw new Error("A complete request cookie adapter is required");
  let cookieAccessFailed = false;
  const auth = createServerClient<FoundationAuthenticatedDatabase, "api">(
    config.url,
    config.publishableKey,
    {
      db: { schema: "api", retry: false },
      cookies: {
        async getAll() {
          try {
            return await cookies.getAll();
          } catch {
            cookieAccessFailed = true;
            return [];
          }
        },
        async setAll(items, headers) {
          try {
            await cookies.setAll(items, headers);
          } catch {
            // SDK refresh subscribers must settle normally. Propagating a
            // callback exception can leave an unhandled refresh rejection;
            // record failure and deny the API immediately after the await.
            cookieAccessFailed = true;
          }
        },
      },
      global: {
        fetch: (request, init) =>
          fetcher(request, { ...init, credentials: "omit", cache: "no-store", redirect: "error" }),
      },
    }
  ).auth;

  let failureStatus: 401 | 503 = 401;
  try {
    const { data, error } = await auth.getSession();
    if (cookieAccessFailed) failureStatus = 503;
    else if (error) failureStatus = authFailureStatus(error);
    if (cookieAccessFailed || error || !data.session?.access_token) throw new Error();
    const token = data.session.access_token;
    const api = createFoundationAuthenticatedApi(config, token, fetcher);
    const claims = caller.parse(
      JSON.parse(atob(token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")))
    );
    if (claims.iss !== `${config.url}/auth/v1` || claims.exp * 1000 <= Date.now())
      throw new Error();
    const verified = await auth.getUser(token);
    if (cookieAccessFailed) failureStatus = 503;
    else if (verified.error) failureStatus = authFailureStatus(verified.error);
    if (
      cookieAccessFailed ||
      verified.error ||
      !verified.data.user ||
      verified.data.user.id !== claims.sub ||
      verified.data.user.is_anonymous
    )
      throw new Error();
    return api;
  } catch {
    // Never include cookie contents, tokens or provider error bodies.
    throw new FoundationSessionError(failureStatus);
  }
}
