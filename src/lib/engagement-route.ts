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
import { getClientRateLimitIdentity } from "@/lib/utils/rate-limit";

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

/** Expands an IPv6 address to its eight groups, or null. */
function ipv6Groups(address: string): string[] | null {
  const plain = address
    .replace(/^\[|\]$/g, "")
    .split("%")[0]!
    .toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(plain) || plain.split("::").length > 2) return null;
  const [head, tail] = plain.includes("::") ? plain.split("::") : [plain, null];
  const split = (part: string | null | undefined) => (part ? part.split(":") : []);
  const left = split(head);
  const right = split(tail);
  // An embedded IPv4 tail counts as two groups.
  const last = (tail === null ? left : right).at(-1);
  if (last?.includes(".")) {
    const octets = last.split(".").map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255))
      return null;
    const groups = [
      ((octets[0]! << 8) | octets[1]!).toString(16),
      ((octets[2]! << 8) | octets[3]!).toString(16),
    ];
    (tail === null ? left : right).splice(-1, 1, ...groups);
  }
  const missing = 8 - left.length - right.length;
  if (tail === null ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array(tail === null ? 0 : missing).fill("0"), ...right];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => group.replace(/^0+(?=.)/, ""));
}

type ClientAddress =
  | { family: "v4"; address: string }
  | { family: "v6"; groups: string[] }
  | { family: "unknown"; key: string };

function clientAddress(request: Request): ClientAddress {
  const identity = getClientRateLimitIdentity(request);
  const ip = identity.ip;
  if (!ip) return { family: "unknown", key: identity.key };
  if (!ip.includes(":")) return { family: "v4", address: ip };
  const groups = ipv6Groups(ip);
  if (!groups) return { family: "unknown", key: identity.key };
  if (groups.slice(0, 5).every((g) => g === "0") && groups[5] === "ffff") {
    const [high, low] = [parseInt(groups[6]!, 16), parseInt(groups[7]!, 16)];
    return { family: "v4", address: `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}` };
  }
  return { family: "v6", groups };
}

/**
 * The limiter key of a client for views and likes: its IPv4 address, or the
 * /64 network of its IPv6 address (an IPv4-mapped IPv6 address is its IPv4
 * address).
 */
export function engagementClientKey(request: Request): string {
  const client = clientAddress(request);
  if (client.family === "v4") return `v4:${client.address}`;
  if (client.family === "v6") return `v6:${client.groups.slice(0, 4).join(":")}::/64`;
  return client.key;
}

/**
 * The limiter action and key for issuing new identifiers: per IPv4 address
 * (a generous allowance, for carrier-grade NAT where many people share one
 * address) or per IPv6 /48, the block one site usually holds, so a host
 * cannot spread over its /64s.
 */
export function viewerIssuingLimit(request: Request) {
  const client = clientAddress(request);
  if (client.family === "v6")
    return {
      action: "engagement:viewer:v6",
      key: `v6:${client.groups.slice(0, 3).join(":")}::/48`,
    };
  return {
    action: "engagement:viewer:v4",
    key: client.family === "v4" ? `v4:${client.address}` : client.key,
  };
}

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
