import { type NextRequest, NextResponse } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { loginSchema } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("Login");

export async function POST(request: NextRequest) {
  const isPlaywrightTestMode = process.env.PLAYWRIGHT_TEST_MODE === "1";
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.TURNSTILE_SECRET_KEY &&
    !isPlaywrightTestMode
  ) {
    return NextResponse.json({ error: "Authentication temporarily unavailable" }, { status: 503 });
  }

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const turnstileFullyConfigured =
    !!process.env.TURNSTILE_SECRET_KEY && !!siteKey && siteKey !== "dummy_site_key";

  // Rate limit by client IP
  const ip = getClientIp(request);
  const rateCheck = await checkRateLimit({ key: ip, action: "auth:login" });
  if (rateCheck.limited) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
    );
  }

  const body = await parseJsonRequest(request);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  if (turnstileFullyConfigured) {
    // If the Turnstile widget failed to load on the client, the token will
    // be "turnstile-unavailable". Apply stricter rate limiting rather than
    // skipping CAPTCHA entirely, as this token is easily spoofed.
    if (parsed.data.turnstileToken === "turnstile-unavailable") {
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
        token: parsed.data.turnstileToken,
        remoteIp: getClientIp(request),
      });

      if (!captcha.success) {
        return NextResponse.json(
          { error: captcha.error || "CAPTCHA verification failed" },
          { status: 400 }
        );
      }
    }
  } else if (process.env.TURNSTILE_SECRET_KEY && !siteKey) {
    log.warn(
      "Turnstile secret key is set but NEXT_PUBLIC_TURNSTILE_SITE_KEY is missing — skipping CAPTCHA verification"
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Surface a specific message for unconfirmed emails so users know to
    // check their inbox, while keeping other errors generic to prevent
    // account enumeration.
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
}
