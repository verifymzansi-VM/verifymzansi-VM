import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import {
  readFoundationCookieToken,
  readFoundationRequestCaller,
  readUnverifiedFoundationTokenClaims,
  FoundationSessionError,
} from "./request-api";
import { readFoundationAccountContext, FoundationAccountContextError } from "./account-context";
import { readFoundationRuntimeConnection } from "./runtime-connection";
import { createFoundationAuthenticatedApi } from "./authenticated-api";
import { FOUNDATION_PAGE_SESSION_HEADER, readFoundationPageSession } from "./page-session-handoff";

export class FoundationServerSessionError extends Error {
  override name = "FoundationServerSessionError";
  constructor(readonly status: 401 | 403 | 503) {
    super("A verified account page session is required");
  }
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/** Requests a platform may route past the proxy (OpenNext skips middleware for
 * its own revalidation requests), so no gate answer can be trusted on them. */
const PROXY_BYPASS_HEADERS = ["x-prerender-revalidate", "x-isr"];

/** The page gate's verified answer for this request (page-session-handoff.ts),
 * when it covers the exact unexpired access token these cookies carry. */
async function readGateSession(connection: unknown, store: CookieStore) {
  try {
    const incoming = await headers();
    if (PROXY_BYPASS_HEADERS.some((name) => incoming.has(name))) return null;
    const value = incoming.get(FOUNDATION_PAGE_SESSION_HEADER);
    if (!value) return null;
    const token = await readFoundationCookieToken(connection, { getAll: () => store.getAll() });
    const claims = readUnverifiedFoundationTokenClaims(connection, token);
    const handed = await readFoundationPageSession(value, token);
    if (!handed || handed.account.account_id !== claims.sub) return null;
    return {
      account: handed.account,
      user: handed.user,
      api: createFoundationAuthenticatedApi(connection, token),
    };
  } catch {
    return null;
  }
}

/** Protected Server Components only. The page proxy owns refresh/cookie writes
 * and private response headers. React cache shares this only within a render
 * request; no module singleton stores another request's identity or privileges.
 * A page request the gate already verified reuses that check; anything else
 * (no or unusable gate answer) verifies with Auth and the database as before.
 */
export const readFoundationServerSession = cache(async () => {
  try {
    const store = await cookies();
    const connection = readFoundationRuntimeConnection();
    const handed = await readGateSession(connection, store);
    if (handed) return handed;
    const caller = await readFoundationRequestCaller(connection, {
      getAll: () => store.getAll(),
    });
    const account = await readFoundationAccountContext(caller.api);
    if (account.account_id !== caller.accountId || caller.user.id !== caller.accountId)
      throw new FoundationServerSessionError(503);
    return { account, user: caller.user, api: caller.api };
  } catch (error) {
    if (error instanceof FoundationServerSessionError) throw error;
    if (error instanceof FoundationSessionError)
      throw new FoundationServerSessionError(error.status);
    if (error instanceof FoundationAccountContextError && error.reason === "forbidden")
      throw new FoundationServerSessionError(403);
    throw new FoundationServerSessionError(503);
  }
});

/** The verified user, or null when no signed-in session reaches the page (the
 * caller sends the visitor to sign in). Any other refusal stays an error. */
export async function readFoundationServerUser() {
  try {
    return (await readFoundationServerSession()).user;
  } catch (error) {
    if (error instanceof FoundationServerSessionError && error.status === 401) return null;
    throw error;
  }
}
