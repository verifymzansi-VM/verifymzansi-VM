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
  foundationVerifierCookieWrites,
  type FoundationAuthCookies,
} from "@/lib/foundation/auth-attempt";
import {
  FoundationPasswordSetupEmailError,
  hasFoundationPasswordSetupKey,
  requestFoundationPasswordSetupEmail,
} from "@/lib/foundation/password-recovery";
import {
  foundationAccountHasNoPassword,
  foundationAuthenticatorStepRecent,
  foundationSignedInRecently,
} from "@/lib/foundation/sign-in-claims";
import { foundationNoStore } from "@/lib/foundation/owner-route";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { logRequestFailure } from "@/lib/utils/request-failure";
import { openedByResetLink, RECOVERY_SESSION_REFUSAL } from "./recovery-session";
import { limiterAddressKey } from "@/lib/foundation/limiter-key";

const log = createLogger("FoundationPasswordSetup");
const UNAVAILABLE = "Password setup is temporarily unavailable";
const inputSchema = z.strictObject({ email: foundationAuthEmail });

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
  emails: () =>
    new SetupRefusal(429, {
      error: "Too many password emails; try again later",
      code: "rate_limited",
    }),
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
 *
 * Budgets: the member's own account (hourly and daily) and a platform-wide one
 * for these CAPTCHA-less emails. The forgot-password page's per-address budget
 * is charged only after a sent email and never refuses here, so nobody else
 * can use it up to block this request.
 */
export async function handleFoundationPasswordSetup(request: NextRequest, input: unknown) {
  const reply = (status: number, body: Record<string, string | boolean>) =>
    NextResponse.json(body, { status, headers: foundationNoStore });
  if (
    process.env.FOUNDATION_PASSWORD_AUTH_MODE !== "native-captcha" ||
    process.env.FOUNDATION_RECOVERY_ENABLED !== "true" ||
    process.env.FOUNDATION_AUTH_CALLBACK_ENABLED !== "true" ||
    !hasFoundationPasswordSetupKey()
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
    // Staff add a sign-in method only right after their authenticator step,
    // as for the database's sensitive staff capabilities.
    if (
      account.staff &&
      (!account.staff.can_access || !foundationAuthenticatorStepRecent(caller.authenticatorAt))
    )
      throw new SetupRefusal(403, {
        error: "Confirm your authenticator code before setting a password",
        code: "mfa_required",
      });
    for (const budget of [
      { key: "account:" + caller.accountId, action: "auth:password-setup" },
      { key: "global", action: "auth:password-setup:global" },
    ]) {
      const result = await checkRateLimit({ ...budget, degradedMode: "block" });
      if (result.degraded) throw refuse.unavailable();
      if (result.limited) throw refuse.emails();
    }
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
    // A sent email counts towards the address's forgot-password budget too
    // (its outcome no longer matters here).
    await checkRateLimit({
      key: await limiterAddressKey(own.data),
      action: "auth:forgot-password-email",
      degradedMode: "block",
    });
    const response = await context.respond(reply(200, { ok: true }));
    // Only the sign-in verifier cookies (the link's slot, and removals of
    // slots the SDK evicted); the member's session cookies are left alone.
    for (const { name, value, options } of foundationVerifierCookieWrites(writes))
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
        body = { ...refuse.emails().body };
      } else log.warn("Password setup email unavailable");
    } else
      body.reference = logRequestFailure(log, "Foundation password setup unavailable", {
        request,
        error,
        action: "auth:password-setup",
      });
    const response = reply(status, body);
    if (status === 429) response.headers.set("Retry-After", "60");
    return context.respond(response);
  }
}
