import type { NextRequest } from "next/server";
import {
  parseFoundationRecoveryInput,
  requestFoundationPasswordRecovery,
  FoundationRecoveryRequestError,
} from "@/lib/foundation/password-recovery";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { handleFoundationAuthAttempt, readFoundationAuthBody } from "../../_lib/attempt-route";
import { isFoundationPasswordSetupInput } from "@/lib/foundation/password-setup-input";
import { handleFoundationPasswordSetup } from "../../_lib/password-setup";
import { limiterAddressKey } from "@/lib/foundation/limiter-key";

export async function POST(request: NextRequest) {
  // The profile page's "Set Password" (signed in, no CAPTCHA token) has its
  // own checks; every other request is a forgot-password request. The body is
  // read once, here, and handed to whichever path answers: a copy of the
  // request (clone) cannot be refused early, as cancelling one copy's stream
  // waits for the other copy to be read too.
  const body = await readFoundationAuthBody(request);
  if (isFoundationPasswordSetupInput(body.input))
    return handleFoundationPasswordSetup(request, body.input);
  return handleFoundationAuthAttempt({
    request,
    body,
    action: "auth:forgot-password",
    enabled:
      process.env.FOUNDATION_RECOVERY_ENABLED === "true" &&
      process.env.FOUNDATION_AUTH_CALLBACK_ENABLED === "true",
    unavailableMessage: "Password recovery is temporarily unavailable",
    async operation(connection, input, cookies) {
      // The whole request is checked before the address's budget is looked
      // at, and the budget is only charged once Auth (which verifies the
      // CAPTCHA) accepts it, so requests without a solved CAPTCHA cannot use
      // up an address's emails (the profile page's password setup shares it).
      const { email } = parseFoundationRecoveryInput(input);
      const recipient = {
        key: await limiterAddressKey(email),
        action: "auth:forgot-password-email",
      } as const;
      const rate = await checkRateLimit({ ...recipient, degradedMode: "block", readOnly: true });
      if (rate.degraded) throw new FoundationRecoveryRequestError(503);
      if (!rate.limited) {
        const callback = new URL(buildAuthCallbackUrl(request, "/reset-password"));
        callback.searchParams.set("backend", "foundation");
        callback.searchParams.set("recovery", "1");
        if (
          await requestFoundationPasswordRecovery(connection, input, callback.toString(), cookies)
        )
          await checkRateLimit({ ...recipient, degradedMode: "block" });
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
