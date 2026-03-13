import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { saPhoneSchema } from "@/lib/validations/shared";
import { sendOtpSms } from "@/lib/services/sms";
import { createLogger } from "@/lib/utils/logger";
import { normalizeSaPhone } from "@/lib/utils/phone";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";

const log = createLogger("OTP");
const OTP_EXPIRY_MS = 5 * 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const otpSendSchema = z.object({ phone: saPhoneSchema });

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
      iterations: 100000,
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // otp_logs is service-only; use admin client to bypass RLS safely in this server route.
    const adminSupabase = createAdminClient();

    const deviceId = request.headers.get("x-device-id") || undefined;
    const externalLimit = await checkRateLimit({
      key: phone,
      action: "otp:send",
      deviceId,
    });
    if (externalLimit.limited) {
      return NextResponse.json(
        { error: "Too many OTP requests. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(externalLimit.retryAfter ?? 60) } }
      );
    }

    // ── Pre-send Rate Limit Check ──
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentAttempts } = await adminSupabase
      .from("otp_challenges")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("phone", phone)
      .gte("created_at", oneHourAgo);

    if (recentAttempts !== null && recentAttempts >= MAX_SENDS_PER_HOUR) {
      return NextResponse.json(
        { error: "Maximum SMS limit reached. Please try again in 1 hour." },
        { status: 429 }
      );
    }

    // Generate 6-digit OTP using Web Crypto (edge-compatible)
    const otp = generateOtp();

    // Hash OTP before storing
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();

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
      return NextResponse.json({ error: "Failed to generate OTP" }, { status: 500 });
    }

    // Keep otp_logs as immutable audit trail.
    const { error: auditError } = await adminSupabase.from("otp_logs").insert({
      phone,
      otp_hash: otpHash,
      expires_at: expiresAt,
    });

    if (auditError) {
      log.warn("Failed to write OTP audit log", { error: auditError.message });
    }

    // Send OTP via Africa's Talking SMS
    let smsSucceeded = false;
    try {
      const smsResult = await sendOtpSms(phone, otp);
      smsSucceeded = smsResult.success;
      if (!smsResult.success) {
        log.warn("SMS sending failed", { error: smsResult.error });
      }
    } catch (smsErr) {
      log.warn("SMS service threw", {
        error: smsErr instanceof Error ? smsErr.message : "unknown",
      });
    }

    if (!smsSucceeded) {
      log.warn("SMS failed for OTP challenge", { phone, userId: user.id });
      return NextResponse.json({ error: "Failed to send OTP. Please try again." }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected error in OTP generation", error);
    return internalApiError();
  }
}
