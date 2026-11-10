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
import { FoundationEmailChangeError } from "@/lib/foundation/email-change";
import {
  foundationAuthenticatorStepRecent,
  foundationSignedInRecently,
} from "@/lib/foundation/sign-in-claims";
import { foundationNoStore } from "@/lib/foundation/owner-route";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import { parseJsonRequest } from "@/lib/utils/api";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { logRequestFailure } from "@/lib/utils/request-failure";
import { holdAnswer } from "@/lib/foundation/answer-floor";
import { limiterAccountAddressKey, limiterAddressKey } from "@/lib/foundation/limiter-key";
import { openedByResetLink } from "./recovery-session";
import { EMAIL_CHANGE_LANDING_PARAM } from "./email-change-landing";

const log = createLogger("FoundationEmailChange");
const UNAVAILABLE = "Email change is temporarily unavailable";
/** Exactly what the restored profile page sends. */
const inputSchema = z.strictObject({ newEmail: foundationAuthEmail });
/** The one answer for an accepted request, whether or not Auth sends the
 * links (an address of another account gets this answer too). */
const ACCEPTED = {
  success: true,
  message:
    "If the new address can be used, a confirmation link is on its way to it and to your current address. The change completes once both links are opened.",
} as const;

class ChangeRefusal extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string; code?: string; reason?: string }
  ) {
    super(body.error);
  }
}

const refuse = {
  unavailable: () => new ChangeRefusal(503, { error: UNAVAILABLE }),
  attempts: () =>
    new ChangeRefusal(429, { error: "Too many attempts; try again shortly", code: "rate_limited" }),
  requests: () =>
    new ChangeRefusal(429, {
      error: "Too many email change requests; try again later",
      code: "rate_limited",
    }),
  authenticator: () =>
    new ChangeRefusal(403, {
      error: "Confirm your authenticator code before changing your email address",
      code: "mfa_required",
    }),
};

/**
 * Every accepted answer waits until this long after Auth was asked, so its
 * timing does not show whether Auth sent the two emails or refused at once
 * because another account has the address. On the test copy Auth took about
 * 0.09 s either way (local mail catcher); hosted Auth sends two emails through
 * the custom SMTP sender before it answers, so the floor leaves a wide margin
 * for that. A slower Auth step is logged (no details) so the floor can be
 * raised.
 */
const EMAIL_CHANGE_ANSWER_TIME = { floorMs: 3000, jitterMs: 1000 };

/**
 * The profile page's email change in foundation mode (`{ newEmail }`).
 *
 * Refused unless the request has same-origin proof, passes the network limit
 * and comes from a GoTrue-verified session that was not opened by a reset (or
 * other emailed) link, whose account has a confirmed current address, names a
 * valid new address that differs from it, signed in with a password or Google
 * within the last hour (the session's `amr` claim, as for password setup),
 * belongs to a live account (staff need an authenticator step within 15
 * minutes; other members with an authenticator need a two-step session) and
 * stays within its budgets: per account (at most one request per two minutes,
 * longer than Auth's own interval between emails, so Auth's interval never
 * answers), per account and new address, per new address per day, and
 * platform-wide. The budgets are charged before Auth is asked and whatever it
 * answers, so they reveal nothing either.
 *
 * Auth then starts the change for that same session (email-change.ts): with
 * secure email change on, the current and the new address each get a
 * confirmation link, and the address changes only once both are opened. The
 * secret key is never used. Those Auth settings (secure email change, and a
 * two-step session for members with an authenticator) are what protect the
 * account, for this page and any other client of Auth; the checks here add to
 * them. An address that belongs to another account, or a refusal for Auth's
 * own email limits, gets the same answer as any accepted request, no sooner
 * than EMAIL_CHANGE_ANSWER_TIME after Auth was asked. An address Auth changed
 * without any confirmation is reported as unavailable and logged.
 *
 * Other sessions stay signed in: the change needs both mailboxes, the password
 * is unchanged, and Auth completes it when a link is opened (possibly on
 * another device), not through this website.
 */
export async function handleFoundationEmailChange(request: NextRequest) {
  const reply = (status: number, body: Record<string, string | boolean>) =>
    NextResponse.json(body, { status, headers: foundationNoStore });
  if (
    process.env.FOUNDATION_PASSWORD_AUTH_MODE !== "native-captcha" ||
    process.env.FOUNDATION_AUTH_CALLBACK_ENABLED !== "true"
  )
    return reply(503, { error: UNAVAILABLE });
  const blocked = enforceMutationRequest(request, log);
  if (blocked) {
    for (const [name, value] of Object.entries(foundationNoStore)) blocked.headers.set(name, value);
    return blocked;
  }
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch {
    return reply(503, { error: UNAVAILABLE });
  }
  try {
    const network = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action: "account:email-change",
      degradedMode: "block",
    });
    if (network.degraded) throw refuse.unavailable();
    if (network.limited) throw refuse.attempts();
    const caller = await context.authenticateCaller();
    if (openedByResetLink(caller))
      throw new ChangeRefusal(403, {
        error: "Finish resetting your password, then sign in again to change your email address",
        reason: "recovery_session",
      });
    const current = foundationAuthEmail.safeParse(caller.user.email ?? "");
    if (!current.success || !caller.user.email_confirmed_at)
      throw new ChangeRefusal(403, {
        error: "Confirm your current email address before changing it",
        code: "email_unconfirmed",
      });
    const sent = inputSchema.safeParse(await parseJsonRequest(request, { maxBytes: 4096 }));
    if (!sent.success)
      throw new ChangeRefusal(400, { error: "Enter a valid email address", code: "invalid_email" });
    const newEmail = sent.data.newEmail;
    if (newEmail === current.data)
      throw new ChangeRefusal(422, {
        error: "This is already your current email address.",
        code: "same_email",
      });
    if (!foundationSignedInRecently(caller.signedInAt))
      throw new ChangeRefusal(403, {
        error: "For your security, sign out and sign in again before changing your email address.",
        code: "reauthentication_required",
      });
    const account = await readFoundationAccountContext(caller.api);
    if (account.account_id !== caller.accountId) throw refuse.unavailable();
    // Staff change a sign-in address only right after their authenticator
    // step, as for the database's sensitive staff capabilities.
    if (
      account.staff &&
      (!account.staff.can_access || !foundationAuthenticatorStepRecent(caller.authenticatorAt))
    )
      throw refuse.authenticator();
    // Auth asks members with an authenticator for a two-step session; ask
    // first, before any budget is spent on a request Auth would refuse.
    if (account.totp_enrolled && caller.authenticatorAt === null) throw refuse.authenticator();
    for (const budget of [
      { key: "account:" + caller.accountId, action: "account:email-change:account" },
      {
        key: await limiterAccountAddressKey(caller.accountId, newEmail),
        action: "account:email-change:recipient",
      },
      { key: await limiterAddressKey(newEmail), action: "account:email-change:address" },
      { key: "global", action: "account:email-change:global" },
    ]) {
      const result = await checkRateLimit({ ...budget, degradedMode: "block" });
      if (result.degraded) throw refuse.unavailable();
      if (result.limited) throw refuse.requests();
    }
    // The links return to the callback's email change landing
    // (email-change-landing.ts), which only picks the page to show.
    const landing = new URL(buildAuthCallbackUrl(request, "/dashboard/profile"));
    landing.searchParams.set("backend", "foundation");
    landing.searchParams.set(EMAIL_CHANGE_LANDING_PARAM, "1");
    const startedAt = Date.now();
    const outcome = await caller.changeEmail(newEmail, landing.toString());
    if (outcome === "applied") {
      // Secure settings never change the address without both confirmations.
      log.error("Email change applied without confirmation; check Auth email settings");
      throw refuse.unavailable();
    }
    // Auth checks whether another account has the address before some of its
    // email limits, so a limit refusal gets the accepted answer too (the
    // account budget above keeps members clear of Auth's own interval).
    if (outcome === "limited") log.warn("Email change held back by Auth's email limits");
    if (Date.now() - startedAt > EMAIL_CHANGE_ANSWER_TIME.floorMs)
      log.warn("Email change took longer than its answer time");
    await holdAnswer(startedAt, EMAIL_CHANGE_ANSWER_TIME);
    return context.respond(reply(200, ACCEPTED));
  } catch (error) {
    let status = 503;
    let body: Record<string, string> = { error: UNAVAILABLE };
    if (error instanceof ChangeRefusal) {
      status = error.status;
      body = { ...error.body };
    } else if (error instanceof FoundationSessionError) {
      if (error.status === 401) {
        status = 401;
        body = { error: "Sign in again to change your email address" };
      }
    } else if (error instanceof FoundationAccountContextError) {
      if (error.reason === "forbidden") {
        status = 403;
        body = { error: "Email change is not permitted for this account" };
      }
    } else if (error instanceof FoundationEmailChangeError) {
      if (error.reason === "mfa_required") {
        status = 403;
        body = { ...refuse.authenticator().body };
      } else if (error.reason === "session") {
        status = 401;
        body = { error: "Sign in again to change your email address" };
      } else if (error.reason === "invalid_email") {
        status = 400;
        body = { error: "Enter a valid email address", code: "invalid_email" };
      } else {
        log.warn("Email change could not be confirmed");
        body = { error: "Your email change could not be confirmed. Try again shortly." };
      }
    } else
      body.reference = logRequestFailure(log, "Foundation email change unavailable", {
        request,
        error,
        action: "account:email-change",
      });
    const response = reply(status, body);
    if (status === 429) response.headers.set("Retry-After", "60");
    return context.respond(response);
  }
}
