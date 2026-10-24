import type { NextRequest } from "next/server";
import {
  requestFoundationPasswordRecovery,
  FoundationRecoveryRequestError,
} from "@/lib/foundation/password-recovery";
import { foundationAuthEmail } from "@/lib/foundation/auth-input";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { handleFoundationAuthAttempt } from "../../_lib/attempt-route";

export function POST(request: NextRequest) {
  return handleFoundationAuthAttempt({
    request,
    action: "auth:forgot-password",
    enabled:
      process.env.FOUNDATION_RECOVERY_ENABLED === "true" &&
      process.env.FOUNDATION_AUTH_CALLBACK_ENABLED === "true",
    unavailableMessage: "Password recovery is temporarily unavailable",
    async operation(connection, input, cookies) {
      const email = foundationAuthEmail.safeParse(
        input && typeof input === "object" && "email" in input ? input.email : null
      );
      if (!email.success) throw new FoundationRecoveryRequestError(400);
      const rate = await checkRateLimit({
        key: email.data,
        action: "auth:forgot-password-email",
        degradedMode: "block",
      });
      if (rate.degraded) throw new FoundationRecoveryRequestError(503);
      if (!rate.limited) {
        const callback = new URL(buildAuthCallbackUrl(request, "/reset-password"));
        callback.searchParams.set("backend", "foundation");
        callback.searchParams.set("recovery", "1");
        await requestFoundationPasswordRecovery(connection, input, callback.toString(), cookies);
      }
      return {
        ok: true,
        message: "If this address has an account, check your inbox for the next step.",
      };
    },
    refusal: (error) =>
      error instanceof FoundationRecoveryRequestError
        ? { status: error.status, error: error.message }
        : null,
  });
}
