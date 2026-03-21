import { type NextRequest, NextResponse } from "next/server";
import { loginSchema } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { getTurnstileConfigStatus, verifyTurnstileToken } from "@/lib/utils/turnstile";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import {
  checkAccountLockout,
  recordFailedLogin,
  clearLockout,
  checkDistributedLockout,
  recordDistributedFailedLogin,
} from "@/lib/utils/account-lockout";
import { isPlaywrightTestMode as checkPlaywrightTestMode } from "@/lib/supabase/playwright-mode";

const log = createLogger("Login");

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
      log.error("Turnstile not configured in production", {
        reason: turnstileStatus.reason,
      });
      return NextResponse.json(
        { error: "Authentication temporarily unavailable" },
        { status: 503 }
      );
    }

    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
      action: "auth:login",
      degradedMode: "local",
    });
    if (rateCheck.limited) {
      if (rateCheck.degraded) {
        return NextResponse.json(
          { error: "Login protection is temporarily unavailable. Please try again shortly." },
          { status: 503, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
        );
      }

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

    // Account lockout: block login after 5 failed attempts within 1 hour
    // Check in-memory lockout first (fast, single-isolate)
    const lockout = checkAccountLockout(parsedBody.data.email);
    if (lockout.locked) {
      log.warn("Account locked due to too many failed attempts", {
        email: parsedBody.data.email,
        ip,
      });
      return NextResponse.json(
        { error: "Account temporarily locked due to too many failed attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(lockout.retryAfter ?? 3600) } }
      );
    }
    // Cross-isolate distributed lockout (survives worker restarts)
    const distLockout = await checkDistributedLockout(parsedBody.data.email);
    if (distLockout.locked) {
      log.warn("Account locked (distributed) due to too many failed attempts", {
        email: parsedBody.data.email,
        ip,
      });
      return NextResponse.json(
        { error: "Account temporarily locked due to too many failed attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(distLockout.retryAfter ?? 3600) } }
      );
    }

    if (turnstileStatus.configured) {
      if (parsedBody.data.turnstileToken === "turnstile-unavailable") {
        log.warn("Turnstile widget failed to load on client — applying strict rate limit", {
          ip,
        });
        const strictCheck = await checkRateLimit({
          key: `strict:${ip}`,
          action: "auth:login:nocaptcha",
          degradedMode: "block",
        });
        if (strictCheck.limited) {
          if (strictCheck.degraded) {
            return NextResponse.json(
              { error: "Login protection is temporarily unavailable. Please try again shortly." },
              { status: 503, headers: { "Retry-After": String(strictCheck.retryAfter ?? 120) } }
            );
          }

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

    if (!error) {
      clearLockout(parsedBody.data.email);
    }

    if (error) {
      if (error.message?.toLowerCase().includes("email not confirmed")) {
        log.info("Login failed: email not confirmed", { email: parsedBody.data.email });
      }

      // Return the same generic error for all auth failures to avoid leaking
      // whether an account exists or is merely awaiting confirmation.
      recordFailedLogin(parsedBody.data.email);
      recordDistributedFailedLogin(parsedBody.data.email).catch(() => {});
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected login error", error);
    return internalApiError();
  }
}
