import { type NextRequest, NextResponse } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { registerSchema } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTurnstileConfigStatus, verifyTurnstileToken } from "@/lib/utils/turnstile";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import {
  ACCOUNT_PHONE_IN_USE_ERROR,
  buildAccountPhoneFields,
  normalizeSaPhone,
} from "@/lib/utils/phone";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

const log = createLogger("Register");

export async function POST(request: NextRequest) {
  const isPlaywrightTestMode = process.env.PLAYWRIGHT_TEST_MODE === "1";
  const turnstileStatus = getTurnstileConfigStatus();

  if (
    process.env.NODE_ENV === "production" &&
    !turnstileStatus.configured &&
    !isPlaywrightTestMode
  ) {
    return NextResponse.json({ error: "Registration temporarily unavailable" }, { status: 503 });
  }

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

  const normalizedPhone = normalizeSaPhone(parsed.data.phone);
  const accountPhoneFields = buildAccountPhoneFields(normalizedPhone);
  const admin = createAdminClient();

  const { data: existingPhoneProfile, error: existingPhoneError } = await admin
    .from(ACCOUNT_PROFILE_WRITE_TABLE)
    .select("id")
    .eq("phone", normalizedPhone)
    .maybeSingle();

  if (existingPhoneError) {
    log.error("Failed to check phone uniqueness during registration", {
      error: existingPhoneError.message,
      code: existingPhoneError.code,
    });
    return NextResponse.json(
      { error: "Registration is temporarily unavailable. Please try again." },
      { status: 500 }
    );
  }

  if (existingPhoneProfile) {
    return NextResponse.json({ error: ACCOUNT_PHONE_IN_USE_ERROR }, { status: 409 });
  }

  const supabase = await createClient();
  const callbackUrl = buildAuthCallbackUrl(request, "/?confirmed=true");
  const { data: signUpData, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: callbackUrl,
      data: {
        display_name: parsed.data.displayName,
        phone: normalizedPhone,
      },
    },
  });

  if (error) {
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      log.warn("Signup email send rate limited", {
        error: error.message,
        status: error.status,
        code: error.code,
      });
      return NextResponse.json(
        {
          error:
            "Confirmation emails are temporarily rate-limited. Please wait a few minutes and try again.",
        },
        { status: 429 }
      );
    }

    // Return generic error to prevent account enumeration
    log.error("Auth error", { error: error.message, status: error.status, code: error.code });
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

  // Create the account profile so downstream flows (dashboard, billing, posting) work.
  if (signUpData?.user?.id) {
    try {
      const { error: profileError } = await admin.from(ACCOUNT_PROFILE_WRITE_TABLE).upsert(
        {
          user_id: signUpData.user.id,
          display_name: parsed.data.displayName,
          ...accountPhoneFields,
          account_verification_status: "incomplete",
          account_status: "active",
        },
        { onConflict: "user_id" }
      );

      if (profileError) {
        if (profileError.code === "23505") {
          return NextResponse.json({ error: ACCOUNT_PHONE_IN_USE_ERROR }, { status: 409 });
        }

        throw profileError;
      }
    } catch (profileError) {
      // Surface phone-uniqueness violations so the user gets a clear error
      // instead of a generic "something went wrong" message.
      if (
        profileError instanceof Error &&
        "code" in profileError &&
        (profileError as unknown as { code: string }).code === "23505"
      ) {
        return NextResponse.json({ error: ACCOUNT_PHONE_IN_USE_ERROR }, { status: 409 });
      }

      // Non-blocking: the user can still confirm email; the account profile can be created later.
      log.warn("Failed to create account profile on registration", {
        userId: signUpData.user.id,
        error: profileError instanceof Error ? profileError.message : "Unknown",
      });
    }
  }

  return NextResponse.json({ success: true });
}
