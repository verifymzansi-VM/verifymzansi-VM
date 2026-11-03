import type { NextRequest } from "next/server";
import {
  FoundationPasswordAuthError,
  signInFoundationPassword,
} from "@/lib/foundation/password-auth";
import { handleFoundationAuthAttempt } from "../_lib/attempt-route";

/** Native Auth consumes the challenge once and stages the resulting session. */
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
        ? { status: error.status, error: error.message, code: error.code }
        : null,
  });
}
