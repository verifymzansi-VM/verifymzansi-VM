import { type NextRequest, NextResponse } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { registerSchema } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("Register");

export async function POST(request: NextRequest) {
  const isPlaywrightTestMode = process.env.PLAYWRIGHT_TEST_MODE === "1";
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.TURNSTILE_SECRET_KEY &&
    !isPlaywrightTestMode
  ) {
    return NextResponse.json({ error: "Registration temporarily unavailable" }, { status: 503 });
  }

  // Turnstile is only fully operational when BOTH the server secret key AND
  // the client site key are configured.  When the site key is missing, the
  // client widget cannot render a real challenge and falls back to a dev-bypass
  // token that Cloudflare will always reject with "invalid-input-response".
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const turnstileFullyConfigured =
    !!process.env.TURNSTILE_SECRET_KEY && !!siteKey && siteKey !== "dummy_site_key";

  // Rate limit by client IP
  const ip = getClientIp(request);
  const rateCheck = await checkRateLimit({ key: ip, action: "auth:register" });
  if (rateCheck.limited) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
    );
  }

  const body = await parseJsonRequest(request);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  if (turnstileFullyConfigured) {
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
  } else if (process.env.TURNSTILE_SECRET_KEY && !siteKey) {
    log.warn(
      "Turnstile secret key is set but NEXT_PUBLIC_TURNSTILE_SITE_KEY is missing — skipping CAPTCHA verification"
    );
  }

  const supabase = await createClient();
  const callbackUrl = new URL("/auth/callback?next=/login?confirmed=true", request.url);
  const { data: signUpData, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: callbackUrl.toString(),
      data: {
        display_name: parsed.data.displayName,
        phone: parsed.data.phone,
      },
    },
  });

  if (error) {
    // Return generic error to prevent account enumeration
    log.error("Auth error", { error: error.message });
    return NextResponse.json(
      { error: "Registration failed. Please try again or use a different email." },
      { status: 400 }
    );
  }

  // Detect existing-account case: Supabase returns a user with empty identities
  // when the email already exists (to prevent enumeration).
  const isExistingAccount =
    signUpData?.user && (!signUpData.user.identities || signUpData.user.identities.length === 0);

  if (isExistingAccount) {
    // Return generic success to avoid leaking that the account already exists
    return NextResponse.json({ success: true });
  }

  // Create seller profile so downstream flows (dashboard, billing, posting) work
  if (signUpData?.user?.id) {
    try {
      const admin = createAdminClient();
      await admin.from("seller_profiles").upsert(
        {
          user_id: signUpData.user.id,
          display_name: parsed.data.displayName,
          phone: parsed.data.phone,
          seller_verification_status: "unverified",
          account_status: "active",
        },
        { onConflict: "user_id" }
      );
    } catch (profileError) {
      // Non-blocking: user can still confirm email; profile can be created later
      log.warn("Failed to create seller profile on registration", {
        userId: signUpData.user.id,
        error: profileError instanceof Error ? profileError.message : "Unknown",
      });
    }
  }

  return NextResponse.json({ success: true });
}
