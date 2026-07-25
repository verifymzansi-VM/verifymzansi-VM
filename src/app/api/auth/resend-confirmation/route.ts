import { type NextRequest, NextResponse } from "next/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import {
  emailSchema,
  trimmedStringSchema,
  trimmedTurnstileTokenSchema,
} from "@/lib/validations/shared";
import { z } from "zod";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { rateLimitExceededResponse } from "@/lib/utils/rate-limit-responses";
import {
  enforcePublicAuthTurnstileAvailability,
  getPublicAuthTurnstileStatus,
} from "../_lib/public-auth-turnstile";

const log = createLogger("ResendConfirmation");

const resendSchema = z.object({
  email: trimmedStringSchema.pipe(emailSchema),
  turnstileToken: trimmedTurnstileTokenSchema,
});

export async function POST(request: NextRequest) {
  try {
    const mutationBlock = enforceMutationRequest(request, log);
    if (mutationBlock) return mutationBlock;

    const unavailableResponse = enforcePublicAuthTurnstileAvailability(
      request,
      "Confirmation resend temporarily unavailable"
    );
    if (unavailableResponse) return unavailableResponse;

    const turnstileStatus = getPublicAuthTurnstileStatus(request);

    // Rate limit aggressively — this triggers outbound emails
    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
      action: "auth:resend-confirmation",
      degradedMode: "local",
    });
    if (rateCheck.limited) {
      return rateLimitExceededResponse({
        degraded: rateCheck.degraded,
        retryAfter: rateCheck.retryAfter,
        degradedMessage:
          "Confirmation email protection is temporarily unavailable. Please try again shortly.",
        limitedMessage: "Too many requests. Please wait before trying again.",
      });
    }

    const bodyResult = await parseAndValidateJsonRequest(request, resendSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const parsed = bodyResult.data;

    if (turnstileStatus.configured) {
      if (parsed.turnstileToken === "turnstile-unavailable") {
        return NextResponse.json(
          { error: "Security verification is temporarily unavailable. Please retry." },
          { status: 503 }
        );
      }

      const captcha = await verifyTurnstileToken({
        token: parsed.turnstileToken,
        remoteIp: ip,
      });

      if (!captcha.success) {
        // Upstream Turnstile detail stays in the server logs written by
        // verifyTurnstileToken; clients get a generic message.
        return NextResponse.json({ error: "CAPTCHA verification failed" }, { status: 400 });
      }
    }

    // Rate limit by email as well so targeted confirmation-email harassment
    // cannot rotate IPs to bypass the per-IP limit.
    const emailRateCheck = await checkRateLimit({
      key: parsed.email.toLowerCase(),
      action: "auth:resend-confirmation-email",
      degradedMode: "local",
    });
    if (emailRateCheck.limited) {
      if (emailRateCheck.degraded) {
        return rateLimitExceededResponse({
          degraded: true,
          retryAfter: emailRateCheck.retryAfter,
          degradedMessage:
            "Confirmation email protection is temporarily unavailable. Please try again shortly.",
          limitedMessage: "Too many requests. Please wait before trying again.",
        });
      }

      // Return generic success to preserve anti-enumeration.
      return NextResponse.json({
        success: true,
        message: "If an account exists with that email, a new confirmation link has been sent.",
      });
    }

    const supabase = await createClient();
    const callbackUrl = buildAuthCallbackUrl(request, "/login?confirmed=true");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: parsed.email,
      options: {
        emailRedirectTo: callbackUrl,
      },
    });

    if (error) {
      log.warn("Resend confirmation failed", {
        error: error.message,
        status: error.status,
        code: error.code,
      });

      if (error.status === 429 || error.code === "over_email_send_rate_limit") {
        return NextResponse.json(
          {
            error:
              "Confirmation emails are temporarily rate-limited. Please wait a few minutes and try again.",
          },
          { status: 429 }
        );
      }
    }

    // Always return success to prevent email enumeration — even if the
    // email doesn't exist or is already confirmed, we respond identically.
    return NextResponse.json({
      success: true,
      message: "If an account exists with that email, a new confirmation link has been sent.",
    });
  } catch (error) {
    log.error("Unexpected resend confirmation error", {
      error: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
