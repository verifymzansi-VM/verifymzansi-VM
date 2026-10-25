import "server-only";

import {
  createServerClient,
  combineChunks,
  stringFromBase64URL,
  type CookieMethodsServer,
} from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { FoundationAuthenticatedDatabase } from "../../../database/foundation/api-role-types";
import { createFoundationAuthenticatedApi } from "./authenticated-api";
import { parseFoundationConnection } from "./connection";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";
import { foundationRpcClientOptions } from "./public-api";
import {
  createFoundationPasswordUpdater,
  createFoundationPasswordResetter,
} from "./password-update";
import { foundationRecoveryClaim } from "./recovery-claims";

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
  session_id: z.uuid(),
  amr: z.unknown().optional(),
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
  return (await createFoundationRequestCaller(input, cookies, fetcher)).api;
}

/** Same verification, also returning the GoTrue-verified account id for
 * trusted server commands that act on the caller's behalf. */
export async function createFoundationRequestCaller(
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
      cookieOptions: { secure: config.url.startsWith("https://") },
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
    const verified = await verifyFoundationCallerToken(config, token, fetcher);
    if (cookieAccessFailed) throw new FoundationSessionError(503);
    return {
      ...verified,
      updatePassword: createFoundationPasswordUpdater(config, token, verified.accountId, fetcher),
      resetPassword: verified.recovery
        ? createFoundationPasswordResetter(
            config,
            token,
            verified.accountId,
            verified.recovery.issuedAt,
            fetcher
          )
        : null,
    };
  } catch (error) {
    if (error instanceof FoundationSessionError) throw error;
    // Never include cookie contents, tokens or provider error bodies.
    throw new FoundationSessionError(failureStatus);
  }
}

/** Verify an explicit candidate without reading, persisting or refreshing a session. */
async function verifyFoundationCallerToken(input: unknown, token: string, fetcher: typeof fetch) {
  const config = parseFoundationConnection(input);
  let failureStatus: 401 | 503 = 401;
  try {
    const api = createFoundationAuthenticatedApi(config, token, fetcher);
    const claims = caller.parse(
      JSON.parse(atob(token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")))
    );
    if (claims.iss !== `${config.url}/auth/v1` || claims.exp * 1000 <= Date.now())
      throw new Error();
    const auth = createClient(
      config.url,
      config.publishableKey,
      foundationRpcClientOptions(fetcher)
    ).auth;
    const verified = await auth.getUser(token);
    if (verified.error) failureStatus = authFailureStatus(verified.error);
    if (
      verified.error ||
      !verified.data.user ||
      verified.data.user.id !== claims.sub ||
      verified.data.user.is_anonymous
    )
      throw new Error();
    // Server-only caller data; role authority still comes from live SQL.
    return {
      api,
      accountId: claims.sub,
      user: verified.data.user,
      recovery: foundationRecoveryClaim(claims.session_id, claims.amr),
    };
  } catch {
    // Never include cookie contents, tokens or provider error bodies.
    throw new FoundationSessionError(failureStatus);
  }
}

/** Protected Server Components cannot publish a refreshed cookie. SDK cookie
 * utilities assemble only a candidate here; GoTrue verifies its exact token.
 * No refresh token is consumed, trusted, persisted or returned to the caller.
 */
export async function readFoundationRequestCaller(
  input: unknown,
  cookies: Required<Pick<CookieMethodsServer, "getAll">>,
  fetcher: typeof fetch = createTimeoutFetch()
) {
  const config = parseFoundationConnection(input);
  let values: Map<string, string>;
  try {
    values = new Map(((await cookies.getAll()) ?? []).map(({ name, value }) => [name, value]));
  } catch {
    throw new FoundationSessionError(503);
  }
  let token: string;
  try {
    const base = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
    const combined = await combineChunks(base, (name) => values.get(name));
    if (!combined || combined.length > 32768) throw new Error();
    const decoded = combined.startsWith("base64-")
      ? stringFromBase64URL(combined.slice(7))
      : combined;
    token = z
      .object({ access_token: z.string().min(1).max(8192) })
      .parse(JSON.parse(decoded)).access_token;
  } catch {
    throw new FoundationSessionError(401);
  }
  return verifyFoundationCallerToken(config, token, fetcher);
}
