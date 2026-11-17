import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { foundationAccountProfileSchema } from "@/lib/foundation/account-profile";
import { foundationRecoveryResetSchema } from "@/lib/foundation/password-update-input";
import {
  FoundationPasswordResetUncertainError,
  FoundationPasswordUpdateError,
} from "@/lib/foundation/password-update";
import { isPwnedPassword, PWNED_PASSWORD_ERROR } from "@/lib/security/pwned-passwords";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { parseJsonRequest } from "@/lib/utils/api";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { sendPasswordChangeNotification } from "@/lib/services/email";
import { createLogger } from "@/lib/utils/logger";
import { logRequestFailure } from "@/lib/utils/request-failure";
import { resolveAppOrigin } from "@/lib/utils/auth-redirect";
import {
  readRecoveryBinding,
  recoveryBindingCookieName,
  recoveryBindingCookieOptions,
  recoveryPageMarker,
  recoveryPageMatches,
} from "@/lib/foundation/recovery-binding";
import { foundationAuthPrivateResponse } from "./attempt-route";
const log = createLogger("FoundationRecovery");
const SESSION_CHANGED = "Your recovery session changed. Check the link again.";
export async function handleFoundationRecoveryCompletion(request: NextRequest, mutate: boolean) {
  const reply = (body: unknown, status = 200) =>
    foundationAuthPrivateResponse(NextResponse.json(body, { status }));
  if (
    process.env.FOUNDATION_PASSWORD_AUTH_MODE !== "native-captcha" ||
    process.env.FOUNDATION_RECOVERY_ENABLED !== "true"
  )
    return reply({ error: "Recovery is unavailable" }, 503);
  if (mutate) {
    const blocked = enforceMutationRequest(request, log);
    if (blocked) return foundationAuthPrivateResponse(blocked);
  }
  let context: ReturnType<typeof createFoundationRouteContext>;
  let config: ReturnType<typeof readFoundationRuntimeConnection>;
  try {
    config = readFoundationRuntimeConnection();
    context = createFoundationRouteContext(config, request);
  } catch {
    return reply({ error: "Recovery is unavailable" }, 503);
  }
  try {
    const reserve = async (key: string) => {
      const limit = await checkRateLimit({
        key,
        action: mutate ? "auth:reset-password" : "profile:read",
        degradedMode: "block",
      });
      if (limit.limited || limit.degraded)
        throw new FoundationPasswordUpdateError(limit.degraded ? 503 : 429, "unavailable");
    };
    await reserve(getClientRateLimitIdentity(request).key);
    const caller = await context.authenticateCaller();
    if (!caller.recovery || !caller.resetPassword)
      return context.respond(
        reply(
          mutate ? { error: "Request a new recovery link" } : { valid: false },
          mutate ? 401 : 200
        )
      );
    // The recovery session this browser's reset link opened (set by the
    // callback). It supplies the session id the restored page does not send.
    const origin = resolveAppOrigin(request);
    const bindingCookie = recoveryBindingCookieName(origin);
    const binding = readRecoveryBinding(request.cookies.get(bindingCookie)?.value);
    if (!binding)
      return context.respond(
        reply(
          mutate ? { error: "Request a new recovery link" } : { valid: false },
          mutate ? 401 : 200
        )
      );
    // Another link opened since (another session or account), or this page
    // belongs to an earlier opening of a link in this browser.
    if (
      binding.session !== caller.recovery.sessionId ||
      binding.account !== caller.accountId ||
      !recoveryPageMatches(
        binding,
        recoveryPageMarker(request.headers.get("referer"), [origin, request.nextUrl.origin])
      )
    )
      return context.respond(
        reply(mutate ? { error: SESSION_CHANGED } : { valid: false }, mutate ? 401 : 200)
      );
    const guard = await caller.api.rpc("get_my_profile", {}, { get: false });
    if (guard.error?.code === "42501") throw new FoundationSessionError(401);
    if (guard.error || !foundationAccountProfileSchema.safeParse(guard.data).success)
      throw new FoundationSessionError(503);
    // The page needs only the answer; ids stay on the server.
    if (!mutate) return context.respond(reply({ valid: true }));
    await reserve("account:" + caller.accountId);
    const parsed = foundationRecoveryResetSchema.safeParse(
      await parseJsonRequest(request, { maxBytes: 4096 })
    );
    if (!parsed.success)
      return context.respond(reply({ error: "Use matching passwords of 12–128 characters" }, 400));
    // A client may still send the id it was given; otherwise the server-side
    // binding supplies it. Either way it must be the live recovery session.
    if ((parsed.data.recoverySessionId ?? binding.session) !== caller.recovery.sessionId)
      return context.respond(reply({ error: SESSION_CHANGED }, 401));
    let breached: boolean;
    try {
      breached = await isPwnedPassword(parsed.data.password);
    } catch {
      return context.respond(
        reply({ error: "Password protection is temporarily unavailable" }, 503)
      );
    }
    if (breached) return context.respond(reply({ error: PWNED_PASSWORD_ERROR }, 400));
    /** After global sign-out the session and its binding are of no further use. */
    const endRecovery = <T>(response: NextResponse<T>, signedOut: boolean) => {
      // One opened link completes at most one reset.
      response.cookies.set(bindingCookie, "", recoveryBindingCookieOptions(origin, 0));
      if (!signedOut) return response;
      const base = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
      for (const name of new Set(
        [...request.cookies.getAll(), ...response.cookies.getAll()].map((item) => item.name)
      )) {
        if (
          name === base ||
          (name.startsWith(base + ".") && /^\d+$/.test(name.slice(base.length + 1)))
        )
          response.cookies.set(name, "", {
            path: "/",
            sameSite: "lax",
            secure: config.url.startsWith("https:"),
            maxAge: 0,
          });
      }
      return response;
    };
    const email = caller.user.email;
    const notify = async () => {
      if (!email) return;
      try {
        const notice = await sendPasswordChangeNotification(email);
        if (!notice.success) log.warn("Recovery notification unavailable");
      } catch {
        log.warn("Recovery notification unavailable");
      }
    };
    let result: Awaited<ReturnType<typeof caller.resetPassword>>;
    try {
      result = await caller.resetPassword(parsed.data.password);
    } catch (error) {
      if (!(error instanceof FoundationPasswordResetUncertainError)) throw error;
      // The owner hears about a change that may have happened.
      await notify();
      // The new password may be in force. Sessions were signed out (best
      // effort); if that worked, the link is spent, otherwise the same form
      // can be sent again (a repeat of a committed password completes).
      const response = await context.respond(
        reply(
          {
            error: error.signOutComplete
              ? "We could not confirm your new password. Try signing in with it, or request a new link."
              : "We could not confirm your new password. Please try again.",
            code: "recovery_unconfirmed",
          },
          503
        )
      );
      return error.signOutComplete ? endRecovery(response, true) : response;
    }
    await notify();
    // A repeat of an already committed password (alreadyCurrent) is the same
    // completed reset as a first success.
    return endRecovery(
      await context.respond(reply({ success: true, signOutComplete: result.signOutComplete })),
      result.signOutComplete
    );
  } catch (error) {
    if (error instanceof FoundationSessionError)
      return context.respond(
        reply(
          mutate ? { error: "Request a new recovery link" } : { valid: false },
          error.status === 503 ? 503 : mutate ? 401 : 200
        )
      );
    if (error instanceof FoundationPasswordUpdateError)
      return context.respond(
        reply(
          {
            error:
              error.reason === "mfa_required"
                ? "Verify your authenticator before trying again"
                : "Recovery could not be completed",
            code: error.reason === "mfa_required" ? "mfa_required" : "recovery_refused",
          },
          error.status
        )
      );
    const reference = logRequestFailure(log, "Foundation recovery unavailable", {
      request,
      error,
      action: mutate ? "auth:reset-password" : "auth:recovery-check",
    });
    return context.respond(reply({ error: "Recovery could not be confirmed", reference }, 503));
  }
}
