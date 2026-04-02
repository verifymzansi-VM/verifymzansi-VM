import { type NextRequest, NextResponse } from "next/server";
import { loginSchema } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { getTurnstileConfigStatus, verifyTurnstileToken } from "@/lib/utils/turnstile";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
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
    const turnstileStatus = getTurnstileConfigStatus({ requestHost: request.nextUrl.hostname });
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

    const clientIdentity = getClientRateLimitIdentity(request);
    const ip = clientIdentity.ip ?? "unknown";
    const rateCheck = await checkRateLimit({
      key: clientIdentity.key,
      action: "auth:login",
      degradedMode: "block",
    });
    if (rateCheck.limited) {
      log.warn("Login rate limit triggered", {
        ip,
        rateLimitKeySource: clientIdentity.source,
        degraded: rateCheck.degraded ?? false,
      });

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
      const retrySeconds = lockout.retryAfter ?? 3600;
      const retryMinutes = Math.ceil(retrySeconds / 60);
      return NextResponse.json(
        {
          error: `Account temporarily locked due to too many failed attempts. Try again in ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.`,
        },
        { status: 429, headers: { "Retry-After": String(retrySeconds) } }
      );
    }
    // Cross-isolate distributed lockout (survives worker restarts)
    const distLockout = await checkDistributedLockout(parsedBody.data.email);
    if (distLockout.locked) {
      log.warn("Account locked (distributed) due to too many failed attempts", {
        email: parsedBody.data.email,
        ip,
      });
      const distRetrySeconds = distLockout.retryAfter ?? 3600;
      const distRetryMinutes = Math.ceil(distRetrySeconds / 60);
      return NextResponse.json(
        {
          error: `Account temporarily locked due to too many failed attempts. Try again in ${distRetryMinutes} minute${distRetryMinutes === 1 ? "" : "s"}.`,
        },
        { status: 429, headers: { "Retry-After": String(distRetrySeconds) } }
      );
    }

    if (turnstileStatus.configured) {
      if (parsedBody.data.turnstileToken === "turnstile-unavailable") {
        log.warn("Turnstile widget failed to load on client — applying strict rate limit", {
          ip,
          rateLimitKeySource: clientIdentity.source,
        });
        const strictCheck = await checkRateLimit({
          key: `strict:${clientIdentity.key}`,
          action: "auth:login:nocaptcha",
          degradedMode: "block",
        });
        if (strictCheck.limited) {
          log.warn("Login no-CAPTCHA rate limit triggered", {
            ip,
            rateLimitKeySource: clientIdentity.source,
            degraded: strictCheck.degraded ?? false,
          });

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
          remoteIp: clientIdentity.ip,
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

    const isEmailNotConfirmed = error?.message?.toLowerCase().includes("email not confirmed");

    if (!error) {
      clearLockout(parsedBody.data.email);
    }

    if (error) {
      // Record failed attempt for ALL auth errors including email-not-confirmed
      // to prevent lockout bypass via unconfirmed accounts.
      recordFailedLogin(parsedBody.data.email);
      recordDistributedFailedLogin(parsedBody.data.email).catch((err) => {
        log.warn("Distributed lockout recording failed", {
          email: parsedBody.data.email.replace(/(.{2}).*(@.*)/, "$1***$2"),
          error: err instanceof Error ? err.message : String(err),
        });
      });

      if (isEmailNotConfirmed) {
        log.info("Login failed: email not confirmed", {
          email: parsedBody.data.email.replace(/(.{2}).*(@.*)/, "$1***$2"),
        });
        return NextResponse.json(
          {
            error: "Please confirm your email address before signing in.",
            code: "email_not_confirmed",
          },
          { status: 403 }
        );
      }

      // Return the same generic error for all auth failures to avoid leaking
      // whether an account exists or is merely awaiting confirmation.
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected login error", error);
    return internalApiError();
  }
}
