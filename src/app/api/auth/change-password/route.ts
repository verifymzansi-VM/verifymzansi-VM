import { type NextRequest, NextResponse } from "next/server";
import { changePasswordSchema } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { sendPasswordChangeNotification } from "@/lib/services/email";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { rateLimitExceededResponse } from "@/lib/utils/rate-limit-responses";
import {
  isPwnedPassword,
  PWNED_PASSWORD_CHECK_UNAVAILABLE_ERROR,
  PWNED_PASSWORD_ERROR,
} from "@/lib/security/pwned-passwords";

const log = createLogger("ChangePassword");

export async function POST(request: NextRequest) {
  try {
    const mutationBlock = enforceMutationRequest(request, log);
    if (mutationBlock) return mutationBlock;

    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
      action: "auth:change-password",
      degradedMode: "local",
    });
    if (rateCheck.limited) {
      return rateLimitExceededResponse({
        degraded: rateCheck.degraded,
        retryAfter: rateCheck.retryAfter,
        degradedMessage:
          "Password change protection is temporarily unavailable. Please try again shortly.",
        limitedMessage: "Too many attempts. Please try again later.",
      });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const parsedBody = await parseAndValidateJsonRequest(request, changePasswordSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: parsedBody.data.currentPassword,
    });

    if (signInError) {
      log.warn("Password change failed: incorrect current password", { userId: user.id });
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }

    try {
      if (await isPwnedPassword(parsedBody.data.newPassword)) {
        return NextResponse.json({ error: PWNED_PASSWORD_ERROR }, { status: 400 });
      }
    } catch (passwordCheckError) {
      log.warn("Password breach check unavailable during password change", {
        userId: user.id,
        error: passwordCheckError instanceof Error ? passwordCheckError.message : "Unknown",
      });
      return NextResponse.json(
        { error: PWNED_PASSWORD_CHECK_UNAVAILABLE_ERROR },
        { status: 503, headers: { "Retry-After": "60" } }
      );
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: parsedBody.data.newPassword,
    });

    if (updateError) {
      log.error("Password update failed", { userId: user.id, error: updateError.message });
      return NextResponse.json(
        { error: "Failed to update password. Please try again." },
        { status: 500 }
      );
    }

    // Revoke every other session after a successful password change so an
    // already-compromised session cannot survive the credential rotation.
    const { error: revokeError } = await supabase.auth.signOut({ scope: "others" });
    if (revokeError) {
      // Session revocation failure is a security concern — log at error level
      // and inform the caller so they can manually sign out other devices.
      log.error("Password updated but failed to revoke other sessions", {
        userId: user.id,
        error: revokeError.message,
      });

      void sendPasswordChangeNotification(user.email).catch((err) => {
        log.warn("Failed to send password change notification", {
          userId: user.id,
          error: err instanceof Error ? err.message : "Unknown",
        });
      });

      return NextResponse.json(
        {
          success: true,
          warning:
            "Password updated but other sessions could not be revoked. Please sign out on other devices manually.",
        },
        { status: 200 }
      );
    }

    // Non-blocking notification so users can spot unauthorized changes
    void sendPasswordChangeNotification(user.email).catch((err) => {
      log.warn("Failed to send password change notification", {
        userId: user.id,
        error: err instanceof Error ? err.message : "Unknown",
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected password change error", error);
    return internalApiError();
  }
}
