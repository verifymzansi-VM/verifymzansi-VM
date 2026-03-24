import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { saPhoneSchema } from "@/lib/validations/shared";
import { sendOtpSms } from "@/lib/services/sms";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { createLogger } from "@/lib/utils/logger";
import { normalizeSaPhone } from "@/lib/utils/phone";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";

const log = createLogger("OTP");
const OTP_EXPIRY_MS = 5 * 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const otpSendSchema = z.object({ phone: saPhoneSchema });

type OtpSendErrorCode =
  | "unauthorized"
  | "rate_limited"
  | "hourly_limit_reached"
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
      headers: retryAfter !== undefined ? { "Retry-After": String(retryAfter) } : undefined,
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
      iterations: 150000,
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

    // otp_logs is service-only; use admin client to bypass RLS safely in this server route.
    const adminSupabase = createAdminClient();

    // Rate limit by phone only — do NOT use client-supplied x-device-id as a
    // rate-limit key because attackers can rotate the header to bypass limits.
    const externalLimit = await checkRateLimit({
      key: phone,
      action: "otp:send",
      degradedMode: "local",
    });
    if (externalLimit.limited) {
      return otpSendError("Too many OTP requests. Please wait before trying again.", 429, {
        code: "rate_limited",
        retryAfter: externalLimit.retryAfter ?? 60,
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
    await adminSupabase
      .from("otp_challenges")
      .update({ expires_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("phone", phone)
      .is("verified_at", null);

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
        phone,
        userId: user.id,
        detail: smsFailureDetail,
      });
      return otpSendError("Failed to send OTP. Please try again.", 502, {
        code: "sms_delivery_failed",
        detail: "The SMS provider could not accept the message.",
        retryAfter: 60,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected error in OTP generation", error);
    return otpSendError("Internal server error", 500, { code: "internal_error" });
  }
}
