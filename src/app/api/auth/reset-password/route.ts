import { type NextRequest, NextResponse } from "next/server";
import { resetPasswordSchema } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { rateLimitExceededResponse } from "@/lib/utils/rate-limit-responses";
import {
  isPwnedPassword,
  PWNED_PASSWORD_CHECK_UNAVAILABLE_ERROR,
  PWNED_PASSWORD_ERROR,
} from "@/lib/security/pwned-passwords";

const log = createLogger("ResetPassword");
const PASSWORD_RECOVERY_COOKIE = "vm_password_recovery";
const PASSWORD_RECOVERY_COOKIE_MAX_AGE_MS = 60 * 60 * 1000;

function hasRecentRecoveryTimestamp(user: { recovery_sent_at?: string | null }): boolean {
  const recoverySentAt = user.recovery_sent_at ? new Date(user.recovery_sent_at).getTime() : 0;
  const oneHourAgo = Date.now() - PASSWORD_RECOVERY_COOKIE_MAX_AGE_MS;
  return Boolean(recoverySentAt && recoverySentAt >= oneHourAgo);
}

function hasRecoveryMarker(request: NextRequest, user: { id?: string }): boolean {
  const marker = request.cookies.get(PASSWORD_RECOVERY_COOKIE)?.value;
  return Boolean(user.id && marker && marker === user.id);
}

function hasValidRecoverySession(
  request: NextRequest,
  user: { id?: string; recovery_sent_at?: string | null }
): boolean {
  return hasRecentRecoveryTimestamp(user) || hasRecoveryMarker(request, user);
}

/**
 * GET /api/auth/reset-password
 *
 * Check if the current session is a valid recovery session.
 * Returns { valid: true } if the user has an active recovery session.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ valid: false }, { status: 200 });
    }

    // Only treat as valid recovery if the Supabase user has a recent recovery
    // timestamp or our callback set a short-lived recovery marker.
    if (!hasValidRecoverySession(request, user)) {
      return NextResponse.json({ valid: false }, { status: 200 });
    }

    return NextResponse.json({ valid: true }, { status: 200 });
  } catch (error) {
    const logger = createLogger("ResetPassword");
    logger.error("Recovery session check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/auth/reset-password
 *
 * Complete a password reset using an active recovery session.
 * The user follows a reset link from email, which sets a recovery session cookie.
 * This route validates the session server-side and updates the password.
 */
export async function POST(request: NextRequest) {
  try {
    const mutationBlock = enforceMutationRequest(request, log);
    if (mutationBlock) return mutationBlock;

    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
      action: "auth:reset-password",
      degradedMode: "local",
    });
    if (rateCheck.limited) {
      return rateLimitExceededResponse({
        degraded: rateCheck.degraded,
        retryAfter: rateCheck.retryAfter,
        degradedMessage:
          "Password reset protection is temporarily unavailable. Please try again shortly.",
        limitedMessage: "Too many attempts. Please try again later.",
      });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Your reset link has expired or is invalid. Please request a new one." },
        { status: 401 }
      );
    }

    if (!hasValidRecoverySession(request, user)) {
      return NextResponse.json(
        { error: "Your reset link has expired or is invalid. Please request a new one." },
        { status: 401 }
      );
    }

    const parsedBody = await parseAndValidateJsonRequest(request, resetPasswordSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    try {
      if (await isPwnedPassword(parsedBody.data.password)) {
        return NextResponse.json({ error: PWNED_PASSWORD_ERROR }, { status: 400 });
      }
    } catch (passwordCheckError) {
      log.warn("Password breach check unavailable during password reset", {
        userId: user.id,
        error: passwordCheckError instanceof Error ? passwordCheckError.message : "Unknown",
      });
      return NextResponse.json(
        { error: PWNED_PASSWORD_CHECK_UNAVAILABLE_ERROR },
        { status: 503, headers: { "Retry-After": "60" } }
      );
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: parsedBody.data.password,
    });

    if (updateError) {
      if (
        updateError.message?.toLowerCase().includes("session") ||
        updateError.message?.toLowerCase().includes("token") ||
        updateError.message?.toLowerCase().includes("expired")
      ) {
        return NextResponse.json(
          { error: "Your reset link has expired. Please request a new one." },
          { status: 401 }
        );
      }
      log.error("Password reset failed", { userId: user.id, error: updateError.message });
      return NextResponse.json(
        { error: "Failed to update password. Please try again." },
        { status: 500 }
      );
    }

    // Invalidate the recovery session so the reset link can't be reused
    await supabase.auth.signOut();

    const response = NextResponse.json({ success: true });
    response.cookies.set({
      name: PASSWORD_RECOVERY_COOKIE,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    logApiError(log, "Unexpected password reset error", error);
    return internalApiError();
  }
}
