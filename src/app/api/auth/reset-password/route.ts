import { type NextRequest, NextResponse } from "next/server";
import { resetPasswordSchema } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";

const log = createLogger("ResetPassword");

/**
 * GET /api/auth/reset-password
 *
 * Check if the current session is a valid recovery session.
 * Returns { valid: true } if the user has an active recovery session.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ valid: false }, { status: 200 });
    }

    return NextResponse.json({ valid: true }, { status: 200 });
  } catch {
    return NextResponse.json({ valid: false }, { status: 200 });
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
    const sameOriginFailure = enforceSameOriginMutation(request, log);
    if (sameOriginFailure) {
      return sameOriginFailure;
    }

    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
      action: "auth:reset-password",
      degradedMode: "local",
    });
    if (rateCheck.limited) {
      if (rateCheck.degraded) {
        return NextResponse.json(
          {
            error:
              "Password reset protection is temporarily unavailable. Please try again shortly.",
          },
          { status: 503, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
        );
      }

      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
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

    const parsedBody = await parseAndValidateJsonRequest(request, resetPasswordSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
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

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected password reset error", error);
    return internalApiError();
  }
}
