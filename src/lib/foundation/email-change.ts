import "server-only";

import { parseFoundationConnection } from "./connection";

export class FoundationEmailChangeError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 429 | 503,
    readonly reason: "invalid_email" | "mfa_required" | "session" | "rate_limited" | "unavailable"
  ) {
    super("The email change could not be requested");
  }
}

/** Auth's refusals meaning "another account already uses this address". */
const ADDRESS_TAKEN = new Set(["email_exists", "user_already_exists"]);
const SESSION_REFUSED = new Set([
  "bad_jwt",
  "no_authorization",
  "session_not_found",
  "session_expired",
]);
const RATE_LIMITED = new Set(["over_email_send_rate_limit", "over_request_rate_limit"]);

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

/** Auth's error code: `code` in replies to API version 2024-01-01 (which this
 * request asks for), `error_code` in older ones. */
function authErrorCode(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const { code, error_code: legacy } = body as Record<string, unknown>;
  return typeof code === "string" ? code : typeof legacy === "string" ? legacy : null;
}

/** An S256 challenge for a random verifier that is never kept (Web Crypto,
 * so it also runs where this module is bundled for the proxy). */
async function unanswerableChallenge() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/**
 * Construct only after exact-token verification (request-api.ts). Asks Auth to
 * start an email change for that same verified session (PUT /user with the
 * member's own token, never the secret key), so Auth's own rules apply: with
 * secure email change on, it emails a confirmation link to the current address
 * and one to the new address, and changes the address only once both are
 * opened. Auth also asks members with an authenticator for a two-step session.
 *
 * The links return to `redirectTo`. The request names a PKCE challenge whose
 * verifier is dropped at once, so the code Auth adds to the last link can never
 * be exchanged for a session: opening a link confirms the address and signs
 * nobody in, on any device (Auth would otherwise put a new session's tokens in
 * that link's address).
 *
 * Returns `applied: true` only if Auth changed the address at once (no
 * confirmation at all, which secure settings never do). An address that
 * already belongs to another account is answered exactly like an accepted
 * request, so the website reveals nothing about other accounts.
 */
export function createFoundationEmailChanger(
  input: unknown,
  token: string,
  subject: string,
  fetcher: typeof fetch
) {
  const connection = parseFoundationConnection(input);
  return async (newEmail: string, redirectTo: string): Promise<{ applied: boolean }> => {
    const challenge = await unanswerableChallenge();
    const target = new URL(`${connection.url}/auth/v1/user`);
    target.searchParams.set("redirect_to", redirectTo);
    let response: Response;
    try {
      response = await fetcher(target.toString(), {
        method: "PUT",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: {
          apikey: connection.publishableKey,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Supabase-Api-Version": "2024-01-01",
        },
        body: JSON.stringify({
          email: newEmail,
          code_challenge: challenge,
          code_challenge_method: "s256",
        }),
      });
    } catch {
      // A timeout or dropped connection may come after Auth sent the links.
      throw new FoundationEmailChangeError(503, "unavailable");
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = authErrorCode(body) ?? "";
      if (ADDRESS_TAKEN.has(code)) return { applied: false };
      if (code === "insufficient_aal") throw new FoundationEmailChangeError(403, "mfa_required");
      if (code === "email_address_invalid")
        throw new FoundationEmailChangeError(400, "invalid_email");
      if (response.status === 429 || RATE_LIMITED.has(code))
        throw new FoundationEmailChangeError(429, "rate_limited");
      if (response.status === 401 || SESSION_REFUSED.has(code))
        throw new FoundationEmailChangeError(401, "session");
      throw new FoundationEmailChangeError(503, "unavailable");
    }
    const user = body && typeof body === "object" && "user" in body ? body.user : body;
    if (!user || typeof user !== "object" || !("id" in user) || user.id !== subject)
      throw new FoundationEmailChangeError(503, "unavailable");
    const email = "email" in user && typeof user.email === "string" ? user.email : "";
    return { applied: email.trim().toLowerCase() === newEmail };
  };
}
