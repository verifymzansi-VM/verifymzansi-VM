import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import {
  readFoundationAccountContext,
  FoundationAccountContextError,
} from "@/lib/foundation/account-context";
import { foundationAuthEmail } from "@/lib/foundation/auth-input";
import {
  foundationVerificationCookies,
  type FoundationAuthCookies,
} from "@/lib/foundation/auth-attempt";
import {
  FoundationPasswordSetupEmailError,
  requestFoundationPasswordSetupEmail,
} from "@/lib/foundation/password-recovery";
import {
  foundationAccountHasNoPassword,
  foundationSignedInRecently,
} from "@/lib/foundation/sign-in-claims";
import { foundationNoStore } from "@/lib/foundation/owner-route";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { openedByResetLink, RECOVERY_SESSION_REFUSAL } from "./recovery-session";

const log = createLogger("FoundationPasswordSetup");
const UNAVAILABLE = "Password setup is temporarily unavailable";
const inputSchema = z.strictObject({ email: foundationAuthEmail });

/** The restored profile page's "Set Password" sends only the member's email
 * (no CAPTCHA token); the forgot-password page always sends a token field. */
export function isFoundationPasswordSetupInput(input: unknown) {
  return (
    !!input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input).length === 1 &&
    Object.hasOwn(input, "email")
  );
}

class SetupRefusal extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string; code?: string; reason?: string }
  ) {
    super(body.error);
  }
}

const refuse = {
  limited: () =>
    new SetupRefusal(429, { error: "Too many attempts; try again shortly", code: "rate_limited" }),
  unavailable: () => new SetupRefusal(503, { error: UNAVAILABLE }),
};

/**
 * "Set Password" for a signed-in member who has no password (signed up with
 * Google). The member gets the usual reset link at their own verified address;
 * the reset page then sets the password with its existing checks (the link's
 * binding, the breach check, signing every session out: recovery-complete.ts).
 *
 * Refused unless the request has same-origin proof, passes the shared limits
 * and comes from a GoTrue-verified session that was not opened by a reset
 * link, signed in within the last hour, belongs to a live account with a
 * confirmed email that matches the page's, and shows no password (a member
 * with one uses Change password, which asks for the current one). GoTrue
 * cannot say whether a Google member added a password later; for such a
 * member signed in with Google this only emails a reset link to their own
 * inbox, as the forgot-password page would (see sign-in-claims.ts).
 */
export async function handleFoundationPasswordSetup(request: NextRequest, input: unknown) {
  const reply = (status: number, body: Record<string, string | boolean>) =>
    NextResponse.json(body, { status, headers: foundationNoStore });
  if (
    process.env.FOUNDATION_PASSWORD_AUTH_MODE !== "native-captcha" ||
    process.env.FOUNDATION_RECOVERY_ENABLED !== "true" ||
    process.env.FOUNDATION_AUTH_CALLBACK_ENABLED !== "true"
  )
    return reply(503, { error: UNAVAILABLE });
  const blocked = enforceMutationRequest(request, log);
  if (blocked) {
    for (const [name, value] of Object.entries(foundationNoStore)) blocked.headers.set(name, value);
    return blocked;
  }
  let connection: ReturnType<typeof readFoundationRuntimeConnection>;
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    connection = readFoundationRuntimeConnection();
    context = createFoundationRouteContext(connection, request);
  } catch {
    return reply(503, { error: UNAVAILABLE });
  }
  try {
    // The same network budget as the forgot-password page.
    const network = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action: "auth:forgot-password",
      degradedMode: "block",
    });
    if (network.degraded) throw refuse.unavailable();
    if (network.limited) throw refuse.limited();
    const caller = await context.authenticateCaller();
    if (openedByResetLink(caller)) throw new SetupRefusal(403, RECOVERY_SESSION_REFUSAL);
    // The link goes only to the verified account's own address; the page's
    // copy must name that same address (it was read when the page loaded).
    const sent = inputSchema.safeParse(input);
    const own = foundationAuthEmail.safeParse(caller.user.email ?? "");
    if (!sent.success || !own.success || sent.data.email !== own.data)
      throw new SetupRefusal(409, {
        error: "Your account details changed. Reload the page and try again.",
        code: "account_changed",
      });
    if (!caller.user.email_confirmed_at)
      throw new SetupRefusal(403, {
        error: "Confirm your email address before setting a password",
        code: "email_unconfirmed",
      });
    // An email or phone sign-in (GoTrue's identities), or this session's own
    // password sign-in, shows a password; the page shows Change for the first.
    if (caller.signedInWithPassword || !foundationAccountHasNoPassword(caller.user))
      throw new SetupRefusal(409, {
        error: "This account already has a password. Use Change password instead.",
        code: "password_exists",
      });
    if (!foundationSignedInRecently(caller.signedInAt))
      throw new SetupRefusal(403, {
        error: "For your security, sign out and sign in again before setting a password.",
        code: "reauthentication_required",
      });
    const account = await readFoundationAccountContext(caller.api);
    if (account.account_id !== caller.accountId) throw refuse.unavailable();
    if (account.staff && !account.staff.can_access)
      throw new SetupRefusal(403, {
        error: "Confirm your authenticator code before setting a password",
        code: "mfa_required",
      });
    // The same per-address budget as the forgot-password page, so the two
    // together cannot flood one inbox. The member hears about the limit.
    const recipient = await checkRateLimit({
      key: own.data,
      action: "auth:forgot-password-email",
      degradedMode: "block",
    });
    if (recipient.degraded) throw refuse.unavailable();
    if (recipient.limited)
      throw new SetupRefusal(429, {
        error: "Too many password emails; try again later",
        code: "rate_limited",
      });
    const callback = new URL(buildAuthCallbackUrl(request, "/reset-password"));
    callback.searchParams.set("backend", "foundation");
    callback.searchParams.set("recovery", "1");
    const writes: Parameters<FoundationAuthCookies["setAll"]>[0] = [];
    await requestFoundationPasswordSetupEmail(connection, own.data, callback.toString(), {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        writes.push(...items);
      },
    });
    const response = await context.respond(reply(200, { ok: true }));
    // Only the link's sign-in verifier (the callback needs it); the member's
    // own session cookies are left as they are.
    for (const { name, value, options } of foundationVerificationCookies(writes))
      response.cookies.set(name, value, options);
    return response;
  } catch (error) {
    let status = 503;
    let body: Record<string, string> = { error: UNAVAILABLE };
    if (error instanceof SetupRefusal) {
      status = error.status;
      body = { ...error.body };
    } else if (error instanceof FoundationSessionError) {
      if (error.status === 401) {
        status = 401;
        body = { error: "Sign in again to set a password" };
      }
    } else if (error instanceof FoundationAccountContextError) {
      if (error.reason === "forbidden") {
        status = 403;
        body = { error: "Password setup is not permitted for this account" };
      }
    } else if (error instanceof FoundationPasswordSetupEmailError) {
      if (error.status === 429) {
        status = 429;
        body = { error: "Too many password emails; try again later", code: "rate_limited" };
      } else log.warn("Password setup email unavailable");
    } else log.error("Foundation password setup unavailable");
    const response = reply(status, body);
    if (status === 429) response.headers.set("Retry-After", "60");
    return context.respond(response);
  }
}
