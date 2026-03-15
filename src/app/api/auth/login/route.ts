import { type NextRequest, NextResponse } from "next/server";
import { loginSchema } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { getTurnstileConfigStatus, verifyTurnstileToken } from "@/lib/utils/turnstile";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";

const log = createLogger("Login");

export async function POST(request: NextRequest) {
  try {
    const isPlaywrightTestMode = process.env.PLAYWRIGHT_TEST_MODE === "1";
    const turnstileStatus = getTurnstileConfigStatus();
    if (
      process.env.NODE_ENV === "production" &&
      !turnstileStatus.configured &&
      !isPlaywrightTestMode
    ) {
      log.error("Turnstile not configured in production", {
        reason: !turnstileStatus.configured ? turnstileStatus.reason : "N/A",
      });
      return NextResponse.json(
        { error: "Authentication temporarily unavailable" },
        { status: 503 }
      );
    }

    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({ key: ip, action: "auth:login" });
    if (rateCheck.limited) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    const parsedBody = await parseAndValidateJsonRequest(request, loginSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    if (turnstileStatus.configured) {
      if (parsedBody.data.turnstileToken === "turnstile-unavailable") {
        log.warn("Turnstile widget failed to load on client — applying strict rate limit", {
          ip,
        });
        const strictCheck = await checkRateLimit({
          key: `strict:${ip}`,
          action: "auth:login:nocaptcha",
        });
        if (strictCheck.limited) {
          return NextResponse.json(
            { error: "Too many login attempts without CAPTCHA. Please try again later." },
            { status: 429, headers: { "Retry-After": String(strictCheck.retryAfter ?? 120) } }
          );
        }
      } else {
        const captcha = await verifyTurnstileToken({
          token: parsedBody.data.turnstileToken,
          remoteIp: ip,
        });

        if (!captcha.success) {
          return NextResponse.json(
            { error: captcha.error || "CAPTCHA verification failed" },
            { status: 400 }
          );
        }
      }
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: parsedBody.data.email,
      password: parsedBody.data.password,
    });

    if (error) {
      if (error.message?.toLowerCase().includes("email not confirmed")) {
        return NextResponse.json(
          {
            error:
              "Please confirm your email address before signing in. Check your inbox for the confirmation link.",
          },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected login error", error);
    return internalApiError();
  }
}
