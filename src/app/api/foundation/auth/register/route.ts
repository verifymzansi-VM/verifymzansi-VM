import type { NextRequest } from "next/server";
import {
  FoundationRegistrationError,
  registerFoundationAccount,
} from "@/lib/foundation/registration";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import { FOUNDATION_POST_SIGNUP_PATH } from "@/lib/foundation/auth-navigation";
import { handleFoundationAuthAttempt } from "../_lib/attempt-route";

export function POST(request: NextRequest) {
  return handleFoundationAuthAttempt({
    request,
    action: "auth:register",
    enabled:
      process.env.FOUNDATION_REGISTRATION_ENABLED === "true" &&
      process.env.FOUNDATION_AUTH_CALLBACK_ENABLED === "true",
    unavailableMessage: "Registration is temporarily unavailable",
    operation: async (connection, input, cookies) => {
      const callback = new URL(buildAuthCallbackUrl(request, FOUNDATION_POST_SIGNUP_PATH));
      callback.searchParams.set("backend", "foundation");
      await registerFoundationAccount(connection, input, callback.toString(), cookies);
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
