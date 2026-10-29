import type { NextRequest } from "next/server";
import { registerSchema } from "../validations/auth";
import { normalizeSaPhone } from "../utils/phone";
import { buildAuthCallbackUrl } from "../utils/auth-redirect";
import { FOUNDATION_POST_SIGNUP_PATH } from "./auth-navigation";
import { FoundationRegistrationError, registerFoundationAccount } from "./registration";
import { handleFoundationAuthAttempt } from "@/app/api/foundation/auth/_lib/attempt-route";

/** Adapt the selected registration form without creating legacy profile rows.
 * Contact/name hints are unverified Auth metadata, never account authority. */
export function handleFoundationRegistration(request: NextRequest, legacyForm = false) {
  return handleFoundationAuthAttempt({
    request,
    action: "auth:register",
    enabled:
      process.env.FOUNDATION_REGISTRATION_ENABLED === "true" &&
      process.env.FOUNDATION_AUTH_CALLBACK_ENABLED === "true",
    unavailableMessage: "Registration is temporarily unavailable",
    operation: async (connection, input, cookies) => {
      let hints: { first_name: string; last_name: string; phone: string } | undefined;
      if (legacyForm) {
        const parsed = registerSchema.safeParse(input);
        if (!parsed.success) throw new FoundationRegistrationError(400);
        const value = parsed.data;
        hints = {
          first_name: value.firstName,
          last_name: value.lastName,
          phone: normalizeSaPhone(value.phone),
        };
        input = {
          displayName: `${value.firstName} ${value.lastName}`,
          email: value.email,
          password: value.password,
          confirmPassword: value.confirmPassword,
          acceptTerms: value.acceptTerms,
          turnstileToken: value.turnstileToken,
        };
      }
      const callback = new URL(buildAuthCallbackUrl(request, FOUNDATION_POST_SIGNUP_PATH));
      callback.searchParams.set("backend", "foundation");
      await registerFoundationAccount(
        connection,
        input,
        callback.toString(),
        cookies,
        undefined,
        hints
      );
      return {
        ok: true,
        message: "If registration is available for this email, check your inbox to continue.",
      };
    },
    refusal: (error) =>
      error instanceof FoundationRegistrationError
        ? { status: error.status, error: error.message }
        : null,
  });
}
