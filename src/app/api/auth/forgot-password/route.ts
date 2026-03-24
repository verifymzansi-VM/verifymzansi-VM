import { type NextRequest, NextResponse } from "next/server";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import { getTurnstileConfigStatus, verifyTurnstileToken } from "@/lib/utils/turnstile";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { isPlaywrightTestMode as checkPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("ForgotPassword");

export async function POST(request: NextRequest) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;

    const isPlaywrightTestMode = checkPlaywrightTestMode();
    const turnstileStatus = getTurnstileConfigStatus({ requestHost: request.nextUrl.hostname });
    if (
      process.env.NODE_ENV === "production" &&
      !turnstileStatus.configured &&
      !isPlaywrightTestMode
    ) {
      return NextResponse.json(
        { error: "Password reset temporarily unavailable" },
        { status: 503 }
      );
    }

    const parsedBody = await parseAndValidateJsonRequest(request, forgotPasswordSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    // Rate limit password resets by IP to prevent email spam (before Turnstile
    // to avoid triggering outbound Turnstile requests for spammy clients)
    const ip = getClientIp(request) || "unknown";
    const rl = await checkRateLimit({
      key: ip,
      action: "auth:forgot-password",
      degradedMode: "local",
    });
    if (rl.limited) {
      if (rl.degraded) {
        return NextResponse.json(
          {
            error:
              "Password reset protection is temporarily unavailable. Please try again shortly.",
          },
          { status: 503, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
        );
      }

      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    if (turnstileStatus.configured) {
      const captcha = await verifyTurnstileToken({
        token: parsedBody.data.turnstileToken,
        remoteIp: getClientIp(request),
      });

      if (!captcha.success) {
        return NextResponse.json(
          { error: captcha.error || "CAPTCHA verification failed" },
          { status: 400 }
        );
      }
    }

    // Rate limit by email to prevent targeted email harassment from multiple IPs
    const emailRl = await checkRateLimit({
      key: parsedBody.data.email.toLowerCase(),
      action: "auth:forgot-password-email",
      degradedMode: "local",
    });
    if (emailRl.limited) {
      if (emailRl.degraded) {
        return NextResponse.json(
          {
            error:
              "Password reset protection is temporarily unavailable. Please try again shortly.",
          },
          { status: 503, headers: { "Retry-After": String(emailRl.retryAfter ?? 60) } }
        );
      }

      // Return generic success to avoid revealing whether the email exists
      return NextResponse.json({ success: true });
    }

    const supabase = await createClient();
    const callbackUrl = buildAuthCallbackUrl(request, "/reset-password");

    // Always return a generic success response to reduce account enumeration.
    await supabase.auth.resetPasswordForEmail(parsedBody.data.email, {
      redirectTo: callbackUrl,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected forgot-password error", error);
    return internalApiError();
  }
}
