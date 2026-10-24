import type { NextRequest } from "next/server";
import {
  FoundationPasswordAuthError,
  signInFoundationPassword,
} from "@/lib/foundation/password-auth";
import { handleFoundationAuthAttempt } from "../_lib/attempt-route";

/** Disabled until target-native CAPTCHA and the foundation browser flow are ready. */
export function POST(request: NextRequest) {
  return handleFoundationAuthAttempt({
    request,
    action: "auth:login",
    unavailableMessage: "Sign-in is temporarily unavailable",
    operation: async (connection, input, cookies) => {
      await signInFoundationPassword(connection, input, cookies);
      return { ok: true };
    },
    refusal: (error) =>
      error instanceof FoundationPasswordAuthError
        ? { status: error.status, error: error.message }
        : null,
  });
}
