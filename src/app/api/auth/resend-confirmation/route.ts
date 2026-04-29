import { type NextRequest, NextResponse } from "next/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { emailSchema, trimmedStringSchema, turnstileTokenSchema } from "@/lib/validations/shared";
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
  turnstileToken: trimmedStringSchema.pipe(turnstileTokenSchema),
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
        return NextResponse.json(
          { error: captcha.error || "CAPTCHA verification failed" },
          { status: 400 }
        );
      }
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
