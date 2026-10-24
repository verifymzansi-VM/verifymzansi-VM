import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import {
  readFoundationAccountContext,
  FoundationAccountContextError,
} from "@/lib/foundation/account-context";
import { foundationPasswordUpdateSchema } from "@/lib/foundation/password-update-input";
import { FoundationPasswordUpdateError } from "@/lib/foundation/password-update";
import { isPwnedPassword, PWNED_PASSWORD_ERROR } from "@/lib/security/pwned-passwords";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { parseJsonRequest } from "@/lib/utils/api";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { sendPasswordChangeNotification } from "@/lib/services/email";
import { createLogger } from "@/lib/utils/logger";
import { foundationNoStore } from "../../_lib/owner-route";

const log = createLogger("FoundationPasswordChange");
export async function handleFoundationPasswordChange(request: NextRequest) {
  const reply = (status: number, error: string) =>
    NextResponse.json({ error }, { status, headers: foundationNoStore });
  if (process.env.FOUNDATION_PASSWORD_AUTH_MODE !== "native-captcha")
    return reply(503, "Password changes are unavailable");
  const blocked = enforceMutationRequest(request, log);
  if (blocked) {
    for (const [name, value] of Object.entries(foundationNoStore)) blocked.headers.set(name, value);
    return blocked;
  }
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch {
    return reply(503, "Password changes are unavailable");
  }
  try {
    const limit = async (key: string) => {
      const result = await checkRateLimit({
        key,
        action: "auth:change-password",
        degradedMode: "block",
      });
      if (result.limited)
        throw new FoundationPasswordUpdateError(result.degraded ? 503 : 429, "unavailable");
    };
    await limit(getClientRateLimitIdentity(request).key);
    const caller = await context.authenticateCaller();
    const account = await readFoundationAccountContext(caller.api);
    if (account.account_id !== caller.accountId)
      throw new FoundationPasswordUpdateError(503, "unavailable");
    if (account.staff && !account.staff.can_access)
      throw new FoundationPasswordUpdateError(403, "mfa_required");
    await limit("account:" + caller.accountId);
    const parsed = foundationPasswordUpdateSchema.safeParse(
      await parseJsonRequest(request, { maxBytes: 4096 })
    );
    if (!parsed.success)
      return context.respond(
        reply(400, "Check the current password and matching new passwords (12–128 characters)")
      );
    let breached: boolean;
    try {
      breached = await isPwnedPassword(parsed.data.newPassword);
    } catch {
      return context.respond(reply(503, "Password protection is temporarily unavailable"));
    }
    if (breached) return context.respond(reply(400, PWNED_PASSWORD_ERROR));
    await caller.updatePassword(parsed.data.currentPassword, parsed.data.newPassword);
    if (caller.user.email) {
      try {
        const notice = await sendPasswordChangeNotification(caller.user.email);
        if (!notice.success) log.warn("Password-change notification unavailable");
      } catch {
        log.warn("Password-change notification unavailable");
      }
    }
    return context.respond(NextResponse.json({ ok: true }));
  } catch (error) {
    if (error instanceof FoundationSessionError)
      return context.respond(
        reply(
          error.status,
          error.status === 401
            ? "Sign in to change your password"
            : "Password changes are unavailable"
        )
      );
    if (error instanceof FoundationAccountContextError && error.reason === "forbidden")
      return context.respond(reply(403, "Password change is not permitted"));
    if (error instanceof FoundationPasswordUpdateError) {
      const message =
        error.reason === "current_password"
          ? "Current password is incorrect"
          : error.reason === "reauthentication"
            ? "Sign out, then sign in again before changing your password"
            : error.reason === "password_policy"
              ? "Choose a different strong password that meets the password requirements"
              : error.reason === "mfa_required"
                ? "Confirm your authenticator code before changing your password"
                : error.status === 429
                  ? "Too many attempts; try again later"
                  : "Password change could not be confirmed";
      return context.respond(
        NextResponse.json(
          { error: message, reason: error.reason },
          { status: error.status, headers: foundationNoStore }
        )
      );
    }
    log.error("Foundation password change unavailable");
    return context.respond(reply(503, "Password change could not be confirmed"));
  }
}
