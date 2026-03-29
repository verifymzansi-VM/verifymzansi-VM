import { type NextRequest, NextResponse } from "next/server";
import { changePasswordSchema } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { sendPasswordChangeNotification } from "@/lib/services/email";

const log = createLogger("ChangePassword");

export async function POST(request: NextRequest) {
  try {
    const sameOriginFailure = enforceSameOriginMutation(request, log);
    if (sameOriginFailure) {
      return sameOriginFailure;
    }

    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
      action: "auth:change-password",
      degradedMode: "local",
    });
    if (rateCheck.limited) {
      if (rateCheck.degraded) {
        return NextResponse.json(
          {
            error:
              "Password change protection is temporarily unavailable. Please try again shortly.",
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
