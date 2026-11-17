import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { parseFoundationAccountContext, type FoundationAccountContext } from "./account-context";
import { digestFoundationToken, toBase64Url } from "./page-session-digest";

/**
 * One sign-in check per page view. The page gate (page-access.ts) verifies the
 * session with Auth and reads the account context once; the page render of the
 * same request reuses that answer (server-session.ts) instead of asking again.
 *
 * The answer travels as a request header from the proxy to the render only;
 * request headers are never sent back to the browser. The proxy deletes any
 * copy a browser sent and then decides the header's final value on every
 * request it lets through (forwardFoundationPageSession), so only the gate can
 * set it. The page still accepts it only for the exact access token its own
 * cookies carry, and otherwise checks in full as before. Nothing is stored
 * beyond the request: the pending value is keyed by the request object.
 */
export const FOUNDATION_PAGE_SESSION_HEADER = "x-vm-page-session";

/** A larger answer is not handed over; the page then checks in full. */
const MAX_HEADER_LENGTH = 16_384;
const OVERRIDE_HEADER = "x-middleware-override-headers";
const FORWARDED_PREFIX = "x-middleware-request-";

const pending = new WeakMap<Request, string>();

const envelope = z.strictObject({
  v: z.literal(1),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  account: z.unknown(),
  user: z.looseObject({ id: z.uuid(), is_anonymous: z.boolean().optional() }),
});

function encode(value: unknown) {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decode(value: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Gate only: hand this request's verified account to its page render. */
export async function rememberFoundationPageSession(
  request: NextRequest,
  verified: { tokenDigest: string; account: FoundationAccountContext; user: User }
) {
  const value = encode({
    v: 1,
    token: verified.tokenDigest,
    account: verified.account,
    user: verified.user,
  });
  if (value.length <= MAX_HEADER_LENGTH) pending.set(request, value);
}

/** Proxy entry: no code in the proxy may read a browser-supplied copy. */
export function dropIncomingFoundationPageSession(request: NextRequest) {
  try {
    request.headers.delete(FOUNDATION_PAGE_SESSION_HEADER);
  } catch {
    // forwardFoundationPageSession removes it from what reaches the page anyway.
  }
}

/**
 * Proxy exit, for every response. A response that lets the request through
 * forwards an explicit list of request headers (Next.js and OpenNext both drop
 * every header not on the list). The list always ends without the incoming
 * header and carries only the value the gate remembered for this request.
 */
export function forwardFoundationPageSession(request: NextRequest, response: NextResponse) {
  const value = pending.get(request);
  pending.delete(request);
  // Only a pass-through or a rewrite reaches a render; both get an explicit list.
  if (
    response.headers.get("x-middleware-next") !== "1" &&
    !response.headers.has("x-middleware-rewrite")
  )
    return response;
  if (!response.headers.has(OVERRIDE_HEADER)) {
    // A plain next() or rewrite() would forward the incoming headers as sent.
    const explicit = NextResponse.next({ request: { headers: request.headers } });
    for (const [name, header] of explicit.headers)
      if (name === OVERRIDE_HEADER || name.startsWith(FORWARDED_PREFIX))
        response.headers.set(name, header);
  }
  const names = (response.headers.get(OVERRIDE_HEADER) ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name && name !== FOUNDATION_PAGE_SESSION_HEADER);
  response.headers.delete(FORWARDED_PREFIX + FOUNDATION_PAGE_SESSION_HEADER);
  if (value) {
    names.push(FOUNDATION_PAGE_SESSION_HEADER);
    response.headers.set(FORWARDED_PREFIX + FOUNDATION_PAGE_SESSION_HEADER, value);
  }
  response.headers.set(OVERRIDE_HEADER, names.join(","));
  return response;
}

/** Page render: the gate's answer for exactly this access token, or null. */
export async function readFoundationPageSession(
  value: string | null | undefined,
  token: string
): Promise<{ account: FoundationAccountContext; user: User } | null> {
  if (!value || value.length > MAX_HEADER_LENGTH) return null;
  try {
    const handed = envelope.parse(decode(value));
    if (handed.token !== (await digestFoundationToken(token))) return null;
    const account = parseFoundationAccountContext(handed.account);
    if (handed.user.id !== account.account_id || handed.user.is_anonymous) return null;
    return { account, user: handed.user as unknown as User };
  } catch {
    return null;
  }
}
