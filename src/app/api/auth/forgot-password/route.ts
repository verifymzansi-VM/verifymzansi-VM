import { type NextRequest, NextResponse } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import { getTurnstileConfigStatus, verifyTurnstileToken } from "@/lib/utils/turnstile";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { isPlaywrightTestMode as checkPlaywrightTestMode } from "@/lib/supabase/playwright-mode";

export async function POST(request: NextRequest) {
  const isPlaywrightTestMode = checkPlaywrightTestMode();
  const turnstileStatus = getTurnstileConfigStatus();
  if (
    process.env.NODE_ENV === "production" &&
    !turnstileStatus.configured &&
    !isPlaywrightTestMode
  ) {
    return NextResponse.json({ error: "Password reset temporarily unavailable" }, { status: 503 });
  }

  const body = await parseJsonRequest(request);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  // Rate limit password resets by IP to prevent email spam (before Turnstile
  // to avoid triggering outbound Turnstile requests for spammy clients)
  const ip = getClientIp(request) || "unknown";
  const rl = await checkRateLimit({
    key: ip,
    action: "auth:forgot-password",
    degradedMode: "block",
  });
  if (rl.limited) {
    if (rl.degraded) {
      return NextResponse.json(
        {
          error: "Password reset protection is temporarily unavailable. Please try again shortly.",
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

  // Rate limit by email to prevent targeted email harassment from multiple IPs
  const emailRl = await checkRateLimit({
    key: parsed.data.email.toLowerCase(),
    action: "auth:forgot-password-email",
    degradedMode: "block",
  });
  if (emailRl.limited) {
    if (emailRl.degraded) {
      return NextResponse.json(
        {
          error: "Password reset protection is temporarily unavailable. Please try again shortly.",
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
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: callbackUrl,
  });

  return NextResponse.json({ success: true });
}
