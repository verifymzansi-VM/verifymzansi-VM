import { type NextRequest, NextResponse } from "next/server";
import { registerSchema } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTurnstileConfigStatus, verifyTurnstileToken } from "@/lib/utils/turnstile";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import { buildAccountPhoneFields, normalizeSaPhone } from "@/lib/utils/phone";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { sendAlreadyRegisteredEmail } from "@/lib/services/email";
import { isPlaywrightTestMode as checkPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";

const log = createLogger("Register");

const ORPHANED_AUTH_USER_DELETE_RETRY_DELAYS_MS = [150, 400] as const;

async function deleteOrphanedAuthUser(userId: string, admin: ReturnType<typeof createAdminClient>) {
  for (let attempt = 0; attempt <= ORPHANED_AUTH_USER_DELETE_RETRY_DELAYS_MS.length; attempt += 1) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (!error) {
      if (attempt > 0) {
        log.info("Deleted orphaned auth user after retry", { userId, attempt: attempt + 1 });
      }
      return;
    }

    const isLastAttempt = attempt === ORPHANED_AUTH_USER_DELETE_RETRY_DELAYS_MS.length;
    log.warn("Failed to delete orphaned auth user after profile conflict", {
      userId,
      attempt: attempt + 1,
      error: error.message,
      code: error.code,
      status: error.status,
    });

    if (isLastAttempt) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, ORPHANED_AUTH_USER_DELETE_RETRY_DELAYS_MS[attempt]);
    });
  }
}

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
      return NextResponse.json({ error: "Registration temporarily unavailable" }, { status: 503 });
    }

    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
      action: "auth:register",
      degradedMode: "block",
    });
    if (rateCheck.limited) {
      if (rateCheck.degraded) {
        return NextResponse.json(
          {
            error: "Registration protection is temporarily unavailable. Please try again shortly.",
          },
          { status: 503, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
        );
      }

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
            // Return generic success to prevent phone number enumeration
            // (matches the existing email-exists behavior above).
            log.info("Registration blocked: phone already in use", {
              userId: signUpData.user.id,
            });
            return NextResponse.json({ success: true });
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
          // Return generic success to prevent phone number enumeration.
          log.info("Registration blocked (catch): phone already in use", {
            userId: signUpData.user.id,
          });
          return NextResponse.json({ success: true });
        }

        log.error("Failed to create account profile on registration — cleaning up auth user", {
          userId: signUpData.user.id,
          error: profileError instanceof Error ? profileError.message : "Unknown",
        });
        await deleteOrphanedAuthUser(signUpData.user.id, admin);
        return NextResponse.json(
          { error: "Registration failed. Please try again." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected registration error", error);
    return internalApiError();
  }
}
