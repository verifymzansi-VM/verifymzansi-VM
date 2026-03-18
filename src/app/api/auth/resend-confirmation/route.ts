import { type NextRequest, NextResponse } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { getTurnstileConfigStatus, verifyTurnstileToken } from "@/lib/utils/turnstile";
import { isPlaywrightTestMode as checkPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { z } from "zod";

const log = createLogger("ResendConfirmation");

const resendSchema = z.object({
  email: z.string().email("Valid email is required"),
  turnstileToken: z.string().min(1, "Complete the CAPTCHA"),
});

export async function POST(request: NextRequest) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;

    const isPlaywrightTestMode = checkPlaywrightTestMode();
    const turnstileStatus = getTurnstileConfigStatus();

    if (
      process.env.NODE_ENV === "production" &&
      !turnstileStatus.configured &&
      !isPlaywrightTestMode
    ) {
      return NextResponse.json(
        { error: "Confirmation resend temporarily unavailable" },
        { status: 503 }
      );
    }

    // Rate limit aggressively — this triggers outbound emails
    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
      action: "auth:resend-confirmation",
      degradedMode: "block",
    });
    if (rateCheck.limited) {
      if (rateCheck.degraded) {
        return NextResponse.json(
          {
            error:
              "Confirmation email protection is temporarily unavailable. Please try again shortly.",
          },
          { status: 503, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
        );
      }

      return NextResponse.json(
        { error: "Too many requests. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const parsed = resendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    if (turnstileStatus.configured) {
      if (parsed.data.turnstileToken === "turnstile-unavailable") {
        return NextResponse.json(
          { error: "Security verification is temporarily unavailable. Please retry." },
          { status: 503 }
        );
      }

      const captcha = await verifyTurnstileToken({
        token: parsed.data.turnstileToken,
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
      email: parsed.data.email,
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
