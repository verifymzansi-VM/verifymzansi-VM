import { type NextRequest, NextResponse } from "next/server";
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
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { sendAlreadyRegisteredEmail } from "@/lib/services/email";

const log = createLogger("Register");

async function deleteOrphanedAuthUser(userId: string, admin: ReturnType<typeof createAdminClient>) {
  try {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      log.error("Failed to delete orphaned auth user after profile conflict", {
        userId,
        error: error.message,
        code: error.code,
        status: error.status,
      });
    }
  } catch (cleanupError) {
    log.error("Unexpected orphaned auth user cleanup failure", {
      userId,
      error: cleanupError instanceof Error ? cleanupError.message : "Unknown",
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const isPlaywrightTestMode =
      process.env.NODE_ENV !== "production" && process.env.PLAYWRIGHT_TEST_MODE === "1";
    const turnstileStatus = getTurnstileConfigStatus();

    if (
      process.env.NODE_ENV === "production" &&
      !turnstileStatus.configured &&
      !isPlaywrightTestMode
    ) {
      return NextResponse.json({ error: "Registration temporarily unavailable" }, { status: 503 });
    }

    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({ key: ip, action: "auth:register" });
    if (rateCheck.limited) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    const parsedBody = await parseAndValidateJsonRequest(request, registerSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    if (turnstileStatus.configured) {
      if (parsedBody.data.turnstileToken === "turnstile-unavailable") {
        return NextResponse.json(
          { error: "Security verification is temporarily unavailable. Please retry." },
          { status: 503 }
        );
      }

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

    const normalizedPhone = normalizeSaPhone(parsedBody.data.phone);
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
    const callbackUrl = buildAuthCallbackUrl(request, "/login?confirmed=true");
    const { data: signUpData, error } = await supabase.auth.signUp({
      email: parsedBody.data.email,
      password: parsedBody.data.password,
      options: {
        emailRedirectTo: callbackUrl,
        data: {
          display_name: parsedBody.data.displayName,
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

      log.error("Auth error", { error: error.message, status: error.status, code: error.code });
      return NextResponse.json(
        { error: "Registration failed. Please try again or use a different email." },
        { status: 400 }
      );
    }

    const isExistingAccount =
      signUpData?.user && (!signUpData.user.identities || signUpData.user.identities.length === 0);

    if (isExistingAccount) {
      // Non-blocking: notify the existing account owner so they have
      // an actionable path (sign in or reset password) without leaking
      // account existence to the requester.
      sendAlreadyRegisteredEmail(parsedBody.data.email).catch((err) => {
        log.warn("Failed to send already-registered email", {
          error: err instanceof Error ? err.message : "Unknown",
        });
      });
      return NextResponse.json({ success: true });
    }

    if (signUpData?.user?.id) {
      try {
        const { error: profileError } = await admin.from(ACCOUNT_PROFILE_WRITE_TABLE).upsert(
          {
            user_id: signUpData.user.id,
            display_name: parsedBody.data.displayName,
            ...accountPhoneFields,
            account_verification_status: "incomplete",
            account_status: "active",
          },
          { onConflict: "user_id" }
        );

        if (profileError) {
          if (profileError.code === "23505") {
            await deleteOrphanedAuthUser(signUpData.user.id, admin);
            return NextResponse.json({ error: ACCOUNT_PHONE_IN_USE_ERROR }, { status: 409 });
          }

          throw profileError;
        }
      } catch (profileError) {
        if (
          profileError instanceof Error &&
          "code" in profileError &&
          (profileError as unknown as { code: string }).code === "23505"
        ) {
          await deleteOrphanedAuthUser(signUpData.user.id, admin);
          return NextResponse.json({ error: ACCOUNT_PHONE_IN_USE_ERROR }, { status: 409 });
        }

        log.warn("Failed to create account profile on registration", {
          userId: signUpData.user.id,
          error: profileError instanceof Error ? profileError.message : "Unknown",
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected registration error", error);
    return internalApiError();
  }
}
