import { NextResponse, type NextRequest } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { saPhoneSchema } from "@/lib/validations/shared";
import { sendOtpSms } from "@/lib/services/sms";
import { createLogger } from "@/lib/utils/logger";
import { normalizeSaPhone } from "@/lib/utils/phone";

const log = createLogger("OTP");
const OTP_EXPIRY_MS = 5 * 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;

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

async function checkExternalOtpRateLimit(
  request: NextRequest,
  phone: string
): Promise<{ allowed: true } | { allowed: false; error: string }> {
  const limiterUrl = process.env.OTP_RATE_LIMITER_URL?.trim();
  if (!limiterUrl) {
    return { allowed: true };
  }

  const timeoutMs = Number(process.env.OTP_RATE_LIMITER_TIMEOUT_MS || 2500);
  const safeTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 2500;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), safeTimeout);

  try {
    const deviceId = request.headers.get("x-device-id") || undefined;
    const response = await fetch(limiterUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, deviceId }),
      signal: controller.signal,
    });

    if (response.status === 429) {
      return { allowed: false, error: "Too many OTP requests. Please wait before trying again." };
    }

    if (!response.ok) {
      log.warn("External OTP rate limiter returned non-OK status", { status: response.status });
    }

    return { allowed: true };
  } catch (error) {
    log.warn("External OTP rate limiter unavailable; falling back to DB limits", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return { allowed: true };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    const parsed = saPhoneSchema.safeParse(body.phone);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    const phone = normalizeSaPhone(parsed.data);
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // otp_logs is service-only; use admin client to bypass RLS safely in this server route.
    const adminSupabase = createAdminClient();

    // ── Optional external rate limiter (Cloudflare worker) ──
    const externalLimit = await checkExternalOtpRateLimit(request, phone);
    if (!externalLimit.allowed) {
      return NextResponse.json({ error: externalLimit.error }, { status: 429 });
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error("Unexpected error in OTP generation", {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
