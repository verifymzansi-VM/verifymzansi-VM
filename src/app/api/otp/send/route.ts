import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { saPhoneSchema } from "@/lib/validations/shared";
import { sendOtpSms } from "@/lib/services/sms";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { createLogger } from "@/lib/utils/logger";
import { ACCOUNT_PHONE_IN_USE_ERROR, normalizeSaPhone } from "@/lib/utils/phone";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { buildVerificationEmailConfirmationRequiredPayload } from "@/lib/constants/verification-email-confirmation";

const log = createLogger("OTP");
const OTP_EXPIRY_MS = 5 * 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const OTP_PBKDF2_ITERATIONS = 100000;
const otpSendSchema = z.object({ phone: saPhoneSchema });

type OtpSendErrorCode =
  | "unauthorized"
  | "already_verified"
  | "rate_limited"
  | "hourly_limit_reached"
  | "database_unavailable"
  | "otp_generation_failed"
  | "sms_delivery_failed"
  | "internal_error";

function otpSendError(
  error: string,
  status: number,
  options?: {
    code?: OtpSendErrorCode;
    detail?: string;
    retryAfter?: number;
  }
) {
  const retryAfter = options?.retryAfter;

  return NextResponse.json(
    {
      error,
      ...(options?.code ? { code: options.code } : {}),
      ...(options?.detail ? { detail: options.detail } : {}),
      ...(retryAfter !== undefined ? { retryAfter } : {}),
    },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        ...(retryAfter !== undefined ? { "Retry-After": String(retryAfter) } : {}),
      },
    }
  );
}

/** Convert a Uint8Array to hex string */
function toHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a cryptographically secure 6-digit OTP using Web Crypto API */
function generateOtp(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  // Map to 100000..999999 range
  const otp = 100000 + (arr[0] % 900000);
  return otp.toString();
}

/**
 * Hash OTP using PBKDF2 via Web Crypto API (edge-compatible)
 */
async function hashOtp(otp: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltHex = toHex(salt);

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(otp), "PBKDF2", false, [
    "deriveBits",
  ]);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      // Cloudflare Workers currently rejects PBKDF2 iteration counts above 100000.
      iterations: OTP_PBKDF2_ITERATIONS,
      hash: "SHA-512",
    },
    keyMaterial,
    512 // 64 bytes = 512 bits
  );
  const hashHex = toHex(new Uint8Array(derivedBits));
  return `${saltHex}:${hashHex}`;
}

export async function POST(request: NextRequest) {
  try {
    const sameOriginFailure = enforceSameOriginMutation(request, log);
    if (sameOriginFailure) {
      return sameOriginFailure;
    }

    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) {
      return csrfBlock;
    }

    const parsedBody = await parseAndValidateJsonRequest(request, otpSendSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const phone = normalizeSaPhone(parsedBody.data.phone);
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return otpSendError("Unauthorized", 401, { code: "unauthorized" });
    }

    if (!user.email_confirmed_at) {
      return NextResponse.json(buildVerificationEmailConfirmationRequiredPayload(), {
        status: 403,
      });
    }

    const { data: existingProfile, error: existingProfileError } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("phone")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingProfileError) {
      log.error("Failed to read existing profile before OTP send", {
        userId: user.id,
        error: existingProfileError.message,
        code: existingProfileError.code,
      });

      return otpSendError("Failed to prepare phone verification. Please try again.", 500, {
        code: "internal_error",
      });
    }

    if (existingProfile?.phone === phone) {
      return otpSendError("This phone number is already verified on your account.", 409, {
        code: "already_verified",
      });
    }

    // otp_logs is service-only; use admin client to bypass RLS safely in this server route.
    let adminSupabase: ReturnType<typeof createAdminClient>;
    try {
      adminSupabase = createAdminClient();
    } catch (adminClientErr) {
      log.error("Failed to initialize Supabase admin client for OTP send", {
        error: adminClientErr instanceof Error ? adminClientErr.message : "Unknown error",
      });
      return otpSendError("Service temporarily unavailable", 503, {
        code: "database_unavailable",
      });
    }

    // Rate limit by user+phone — using phone alone lets attackers reset
    // the counter by staging a different number.  Including the userId
    // ensures the per-user send cadence is enforced regardless of phone.
    const externalLimit = await checkRateLimit({
      key: `${user.id}:${phone}`,
      action: "otp:send",
      degradedMode: "local",
    });
    if (externalLimit.limited) {
      return otpSendError("Too many OTP requests. Please wait before trying again.", 429, {
        code: "rate_limited",
        retryAfter: externalLimit.retryAfter ?? 60,
      });
    }

    // Keep verification staging aligned with the phone that received this OTP.
    const { error: stagePendingPhoneError } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .update({ pending_phone: phone })
      .eq("user_id", user.id);

    if (stagePendingPhoneError) {
      if (stagePendingPhoneError.code === "23505") {
        return otpSendError(ACCOUNT_PHONE_IN_USE_ERROR, 409);
      }

      log.error("Failed to stage pending_phone before OTP send", {
        userId: user.id,
        phone: phone.slice(0, 4) + "****" + phone.slice(-2),
        error: stagePendingPhoneError.message,
        code: stagePendingPhoneError.code,
      });

      return otpSendError("Failed to prepare phone verification. Please try again.", 500, {
        code: "internal_error",
      });
    }

    // ── Pre-send Rate Limit Check ──
    // Count only provider-accepted sends so failed delivery attempts do not
    // consume the member's hourly allowance.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentAttempts } = await adminSupabase
      .from("otp_logs")
      .select("*", { count: "exact", head: true })
      .eq("phone", phone)
      .eq("delivery_status", "sent")
      .gte("created_at", oneHourAgo);

    if (recentAttempts !== null && recentAttempts >= MAX_SENDS_PER_HOUR) {
      return otpSendError("Maximum SMS limit reached. Please try again in 1 hour.", 429, {
        code: "hourly_limit_reached",
        retryAfter: 60 * 60,
      });
    }

    // Generate 6-digit OTP using Web Crypto (edge-compatible)
    const otp = generateOtp();

    // Hash OTP before storing
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();

    // Invalidate any prior pending challenges for this user+phone to prevent
    // an accumulation of valid OTPs (replay window).
    const { error: invalidateErr } = await adminSupabase
      .from("otp_challenges")
      .update({ expires_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("phone", phone)
      .is("verified_at", null);
    if (invalidateErr) {
      log.error("Failed to invalidate prior OTP challenges (non-fatal)", {
        error: invalidateErr.message,
        userId: user.id,
      });
    }

    // Store challenge state in user-bound challenge table
    const { error: challengeError } = await adminSupabase.from("otp_challenges").insert({
      user_id: user.id,
      phone,
      otp_hash: otpHash,
      expires_at: expiresAt,
    });

    if (challengeError) {
      log.error("Failed to store OTP challenge", {
        error: challengeError.message,
        code: challengeError.code,
      });
      return otpSendError("Failed to generate OTP", 500, { code: "otp_generation_failed" });
    }

    // Send OTP via Africa's Talking SMS
    let smsSucceeded = false;
    let smsMessageId: string | undefined;
    let smsFailureDetail: string | undefined;
    try {
      const smsResult = await sendOtpSms(phone, otp);
      smsSucceeded = smsResult.success;
      smsMessageId = smsResult.messageId;
      if (!smsResult.success) {
        smsFailureDetail = smsResult.error;
        log.warn("SMS sending failed", { error: smsResult.error });
      }
    } catch (smsErr) {
      smsFailureDetail = smsErr instanceof Error ? smsErr.message : "unknown";
      log.warn("SMS service threw", {
        error: smsFailureDetail,
      });
    }

    // Keep otp_logs as immutable audit trail with the provider outcome attached.
    const { error: auditError } = await adminSupabase.from("otp_logs").insert({
      phone,
      otp_hash: otpHash,
      expires_at: expiresAt,
      delivery_status: smsSucceeded ? "sent" : "failed",
      provider_name: "africastalking",
      provider_message_id: smsMessageId,
      provider_error: smsFailureDetail ?? null,
    });

    if (auditError) {
      log.warn("Failed to write OTP audit log", { error: auditError.message });
    }

    if (!smsSucceeded) {
      log.warn("SMS failed for OTP challenge", {
        phone: phone.slice(0, 4) + "****" + phone.slice(-2),
        userId: user.id,
        detail: smsFailureDetail,
      });
      return otpSendError("Failed to send OTP. Please try again.", 502, {
        code: "sms_delivery_failed",
        detail: "The SMS provider could not accept the message.",
        retryAfter: 60,
      });
    }

    return NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    logApiError(log, "Unexpected error in OTP generation", error, {
      errorType: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return otpSendError("Internal server error", 500, { code: "internal_error" });
  }
}
