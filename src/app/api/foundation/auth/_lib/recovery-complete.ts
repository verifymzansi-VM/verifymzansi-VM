import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { foundationAccountProfileSchema } from "@/lib/foundation/account-profile";
import { foundationRecoveryResetSchema } from "@/lib/foundation/password-update-input";
import { FoundationPasswordUpdateError } from "@/lib/foundation/password-update";
import { isPwnedPassword, PWNED_PASSWORD_ERROR } from "@/lib/security/pwned-passwords";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { parseJsonRequest } from "@/lib/utils/api";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { sendPasswordChangeNotification } from "@/lib/services/email";
import { createLogger } from "@/lib/utils/logger";
import { foundationAuthPrivateResponse } from "./attempt-route";
const log = createLogger("FoundationRecovery");
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
    const guard = await caller.api.rpc("get_my_profile", {}, { get: false });
    if (guard.error?.code === "42501") throw new FoundationSessionError(401);
    if (guard.error || !foundationAccountProfileSchema.safeParse(guard.data).success)
      throw new FoundationSessionError(503);
    if (!mutate)
      return context.respond(
        reply({
          valid: true,
          recoverySessionId: caller.recovery.sessionId,
          accountId: caller.accountId,
        })
      );
    await reserve("account:" + caller.accountId);
    const parsed = foundationRecoveryResetSchema.safeParse(
      await parseJsonRequest(request, { maxBytes: 4096 })
    );
    if (!parsed.success)
      return context.respond(reply({ error: "Use matching passwords of 12–128 characters" }, 400));
    if (parsed.data.recoverySessionId !== caller.recovery.sessionId)
      return context.respond(
        reply({ error: "Your recovery session changed. Check the link again." }, 401)
      );
    let breached: boolean;
    try {
      breached = await isPwnedPassword(parsed.data.password);
    } catch {
      return context.respond(
        reply({ error: "Password protection is temporarily unavailable" }, 503)
      );
    }
    if (breached) return context.respond(reply({ error: PWNED_PASSWORD_ERROR }, 400));
    const result = await caller.resetPassword(parsed.data.password);
    if (caller.user.email) {
      try {
        const notice = await sendPasswordChangeNotification(caller.user.email);
        if (!notice.success) log.warn("Recovery notification unavailable");
      } catch {
        log.warn("Recovery notification unavailable");
      }
    }
    const response = await context.respond(
      reply({ success: true, signOutComplete: result.signOutComplete })
    );
    if (result.signOutComplete) {
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
    }
    return response;
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
    log.error("Foundation recovery unavailable");
    return context.respond(reply({ error: "Recovery could not be confirmed" }, 503));
  }
}
