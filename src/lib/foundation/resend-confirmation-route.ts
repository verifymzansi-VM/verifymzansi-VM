import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationAuthAttempt } from "./auth-attempt-route";
import { createFoundationAuthAttempt, foundationVerificationCookies } from "./auth-attempt";
import { foundationAuthEmail, foundationCaptchaToken } from "./auth-input";
import { FoundationRegistrationError } from "./registration";
import { FOUNDATION_POST_SIGNUP_PATH } from "./auth-navigation";
import { buildAuthCallbackUrl } from "../utils/auth-redirect";
import { checkRateLimit } from "../utils/rate-limit";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";

const inputSchema = z.strictObject({
  email: foundationAuthEmail,
  turnstileToken: foundationCaptchaToken,
});

/** The same native CAPTCHA and PKCE flow as signup. Do not Siteverify the
 * single-use token first, or borrow an incoming user's session/verifier. */
export function handleFoundationResendConfirmation(request: NextRequest) {
  return handleFoundationAuthAttempt({
    request,
    action: "auth:resend-confirmation",
    enabled:
      process.env.FOUNDATION_REGISTRATION_ENABLED === "true" &&
      process.env.FOUNDATION_AUTH_CALLBACK_ENABLED === "true",
    unavailableMessage: "Confirmation email is temporarily unavailable",
    operation: async (connection, input, cookies) => {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) throw new FoundationRegistrationError(400);
      const accepted = {
        success: true,
        message: "If an account exists with that email, a new confirmation link has been sent.",
      };
      const limit = await checkRateLimit({
        key: parsed.data.email,
        action: "auth:resend-confirmation-email",
        degradedMode: "block",
      });
      if (limit.degraded) throw new FoundationRegistrationError(503);
      if (limit.limited) return accepted;
      const callback = new URL(buildAuthCallbackUrl(request, FOUNDATION_POST_SIGNUP_PATH));
      callback.searchParams.set("backend", "foundation");
      const verifiers: Parameters<typeof cookies.setAll>[0] = [];
      const attempt = createFoundationAuthAttempt(
        connection,
        {
          getAll: cookies.getAll,
          setAll: async (items, headers) => {
            verifiers.push(...foundationVerificationCookies(items));
            await cookies.setAll(items, headers);
          },
        },
        createTimeoutFetch()
      );
      const { error } = await attempt.auth.resend({
        type: "signup",
        email: parsed.data.email,
        options: {
          emailRedirectTo: callback.toString(),
          captchaToken: parsed.data.turnstileToken,
        },
      });
      if (attempt.cookieAccessFailed()) throw new FoundationRegistrationError(503);
      if (error) {
        if (error.status === 429) throw new FoundationRegistrationError(429);
        if (
          ["email_not_found", "user_not_found", "email_exists", "user_already_exists"].includes(
            error.code ?? ""
          )
        ) {
          await cookies.setAll(verifiers, {});
          return accepted;
        }
        throw new FoundationRegistrationError(
          [400, 401, 403, 422].includes(error.status ?? 0) ? 400 : 503
        );
      }
      return accepted;
    },
    refusal: (error) =>
      error instanceof FoundationRegistrationError
        ? { status: error.status, error: error.message }
        : null,
  });
}
