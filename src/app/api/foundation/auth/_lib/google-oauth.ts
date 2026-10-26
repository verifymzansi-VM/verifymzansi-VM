import type { NextRequest } from "next/server";
import { googleOAuthInitSchema } from "@/lib/validations/auth";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import { beginFoundationGoogleOAuth } from "@/lib/foundation/google-oauth";
import { handleFoundationAuthAttempt } from "./attempt-route";

export function handleFoundationGoogleOAuth(request: NextRequest) {
  return handleFoundationAuthAttempt({
    request,
    action: "auth:login",
    enabled: process.env.FOUNDATION_AUTH_CALLBACK_ENABLED === "true",
    unavailableMessage: "Google sign-in is temporarily unavailable. Please try again.",
    operation: async (connection, input, cookies) => {
      const parsed = googleOAuthInitSchema.strict().parse(input);
      const callback = new URL(buildAuthCallbackUrl(request, sanitizeReturnUrl(parsed.returnUrl)));
      callback.searchParams.set("backend", "foundation");
      callback.searchParams.set("oauth", "google");
      return beginFoundationGoogleOAuth(connection, callback.toString(), cookies);
    },
    refusal: () => null,
  });
}
