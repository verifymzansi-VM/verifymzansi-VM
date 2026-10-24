import { type NextRequest, NextResponse } from "next/server";
import { changePasswordSchema } from "@/lib/validations/auth";
import { createClient, createPublicClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { sendPasswordChangeNotification } from "@/lib/services/email";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { rateLimitExceededResponse } from "@/lib/utils/rate-limit-responses";
import { checkPasswordBreach, PWNED_PASSWORD_ERROR } from "@/lib/security/pwned-passwords";
import { getDataBackend } from "@/lib/data-backend";

const log = createLogger("ChangePassword");

export async function POST(request: NextRequest) {
  if (getDataBackend() === "foundation") {
    const { handleFoundationPasswordChange } =
      await import("@/app/api/foundation/auth/_lib/password-change");
    return handleFoundationPasswordChange(request);
  }
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

    // Legacy projects may not enforce current_password themselves. Verify on a
    // cookieless client so the password-only sign-in cannot replace an existing
    // AAL2 browser session. Retire only this temporary session afterwards.
    const verifier = createPublicClient();
    let passwordVerified = false;
    try {
      const { data, error } = await verifier.auth.signInWithPassword({
        email: user.email,
        password: parsedBody.data.currentPassword,
      });
      passwordVerified = !error && data.user?.id === user.id;
    } finally {
      const { error } = await verifier.auth.signOut({ scope: "local" });
      if (error) log.error("Temporary password verification session cleanup failed");
    }

    if (!passwordVerified) {
      log.warn("Password change failed: incorrect current password", { userId: user.id });
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }

    // Fails open: an unreachable breach service is logged, not shown to the user.
    if (
      (await checkPasswordBreach(parsedBody.data.newPassword, "change_password")) === "breached"
    ) {
      return NextResponse.json({ error: PWNED_PASSWORD_ERROR }, { status: 400 });
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: parsedBody.data.newPassword,
      current_password: parsedBody.data.currentPassword,
    });

    if (updateError) {
      if (updateError.code === "insufficient_aal") {
        return NextResponse.json(
          { code: "mfa_required", error: "Verify your authenticator code before trying again." },
          { status: 403 }
        );
      }
      if (updateError.code === "reauthentication_needed") {
        return NextResponse.json(
          {
            code: "reauthentication_required",
            error: "Sign in again before changing your password.",
          },
          { status: 409 }
        );
      }
      if (
        [
          "current_password_invalid",
          "current_password_mismatch",
          "current_password_required",
        ].includes(updateError.code ?? "")
      ) {
        return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
      }
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

      await sendPasswordChangeNotification(user.email).catch((err) => {
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

    // Finish the security notification before the Worker request ends.
    await sendPasswordChangeNotification(user.email).catch((err) => {
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
