import { scheduleBackgroundTask } from "@/lib/utils/background-task";
import { NextResponse, type NextRequest } from "next/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { otpVerifySchema } from "@/lib/validations/auth";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { ACCOUNT_PHONE_IN_USE_ERROR, normalizeSaPhone } from "@/lib/utils/phone";
import { sendSms } from "@/lib/services/sms";
import { sendPhoneChangeNotification } from "@/lib/services/email";
import { createNotification } from "@/lib/notifications";
import { buildVerificationEmailConfirmationRequiredPayload } from "@/lib/constants/verification-email-confirmation";

const log = createLogger("OTPVerify");
const MAX_VERIFY_ATTEMPTS = 5;
const OTP_PBKDF2_ITERATIONS = 100000;
const NO_CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

// Re-exported from shared module
import { phoneReverificationRequired } from "@/lib/account/identity-policy";
import { ensureAccountProfile } from "@/lib/account/ensure-profile";

/** Convert a hex string to Uint8Array */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/** Convert a Uint8Array to hex string */
function toHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify OTP against stored hash using Web Crypto API (edge-compatible)
 */
async function verifyOtp(otp: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(otp), "PBKDF2", false, [
    "deriveBits",
  ]);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromHex(salt).buffer as ArrayBuffer,
      // Keep in sync with send route and within Cloudflare Workers PBKDF2 limits.
      iterations: OTP_PBKDF2_ITERATIONS,
      hash: "SHA-512",
    },
    keyMaterial,
    512
  );
  const otpHashHex = toHex(new Uint8Array(derivedBits));

  // Constant-time comparison — no early exit on length mismatch to avoid
  // leaking whether a valid hash exists via timing side-channel.
  const a = fromHex(hash);
  const b = fromHex(otpHashHex);
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length; // non-zero if lengths differ
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

async function finalizePhoneVerification(
  adminSupabase: ReturnType<typeof createAdminClient>,
  user: { id: string; email?: string | null; user_metadata?: unknown },
  phone: string,
  challenge: { id: string; otp_hash: string }
): Promise<
  | { success: true; alreadyVerified: boolean; phoneChanged: boolean }
  | { success: false; error: string; status: number; code?: string; retryAfter?: number }
> {
  if (!(await ensureAccountProfile(adminSupabase, user))) {
    return {
      success: false,
      error: "Unable to prepare your account. Please try again.",
      status: 503,
    };
  }
  // The service-only RPC owns the claim and every durable verification write.
  // Never fall back to separate HTTP writes if its migration is unavailable.
  const { data, error } = await adminSupabase.rpc("finalize_otp_phone_verification", {
    p_user_id: user.id,
    p_challenge_id: challenge.id,
    p_expected_hash: challenge.otp_hash,
    p_phone: phone,
  });
  if (error) {
    log.error("Atomic phone verification failed", { userId: user.id, databaseCode: error.code });
    return {
      success: false,
      error:
        error.code === "23505"
          ? ACCOUNT_PHONE_IN_USE_ERROR
          : "Verification temporarily unavailable. Please try again.",
      status: error.code === "23505" ? 409 : 503,
    };
  }
  if (data?.outcome === "verified" || data?.outcome === "already_verified") {
    return {
      success: true,
      alreadyVerified: data.outcome === "already_verified",
      phoneChanged: data.phone_changed === true,
    };
  }
  if (data?.outcome === "invalid_challenge")
    return { success: false, error: "Invalid or expired OTP", status: 400 };
  if (data?.outcome === "account_restricted")
    return { success: false, error: "Your account cannot complete verification.", status: 403 };
  if (data?.outcome === "phone_reverification_required") {
    const policy = phoneReverificationRequired();
    return { success: false, error: policy.message, code: policy.code, status: 403 };
  }
  if (data?.outcome === "phone_cooldown")
    return {
      success: false,
      error: "Please wait before changing your phone number again.",
      code: "PHONE_COOLDOWN",
      status: 429,
      retryAfter:
        Number.isFinite(data.retry_after) && data.retry_after > 0
          ? Math.ceil(data.retry_after)
          : 60,
    };
  return {
    success: false,
    error: "Verification temporarily unavailable. Please try again.",
    status: 503,
  };
}

async function announcePhoneChange(userId: string, email: string | null, phone: string) {
  const last3 = phone.slice(-3);
  await Promise.allSettled([
    createNotification({
      userId,
      type: "warning",
      title: "Your phone number was changed",
      message: `Buyers now see a number ending in ${last3}. If this wasn't you, reset your password.`,
      href: "/dashboard/settings",
    }),
    email ? sendPhoneChangeNotification(email, last3) : Promise.resolve(),
  ]);
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

    // Rate limit by IP to prevent brute-force across multiple OTP challenges
    const ip = getClientIp(request);
    const rl = await checkRateLimit({
      key: ip,
      action: "otp:verify",
      degradedMode: "local",
    });
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const parsedBody = await parseAndValidateJsonRequest(request, otpVerifySchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const { otp } = parsedBody.data;
    const phone = normalizeSaPhone(parsedBody.data.phone);
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!user.email_confirmed_at) {
      return NextResponse.json(buildVerificationEmailConfirmationRequiredPayload(), {
        status: 403,
      });
    }

    // Per-account cap across challenges and IPs; the per-IP limit above can be
    // spread over many addresses.
    const userLimit = await checkRateLimit({
      key: user.id,
      action: "otp:verify:user",
      degradedMode: "block",
    });
    if (userLimit.limited) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(userLimit.retryAfter ?? 60) } }
      );
    }

    // If a pending_phone exists, OTP verification must target that exact staged value.
    // This prevents verifying a phone number that was not explicitly staged for this user.
    const { data: profileGuard, error: profileGuardErr } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("pending_phone, phone")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileGuardErr) {
      log.error("Failed to fetch profile guard for OTP verification", {
        userId: user.id,
        error: profileGuardErr.message,
      });
      return NextResponse.json({ error: "Unable to verify account" }, { status: 500 });
    }

    if (profileGuard?.pending_phone && normalizeSaPhone(profileGuard.pending_phone) !== phone) {
      return NextResponse.json({ error: "Invalid or expired OTP" }, { status: 400 });
    }

    // Use service-role for challenge state transitions.
    const adminSupabase = createAdminClient();

    const now = new Date();
    const nowIso = now.toISOString();

    // Only challenge rows owned by this user+phone are eligible.
    const { data: challenge, error } = await adminSupabase
      .from("otp_challenges")
      .select("id, otp_hash, attempt_count, locked_until, expires_at, verified_at")
      .eq("user_id", user.id)
      .eq("phone", phone)
      .gte("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      log.error("OTP challenge lookup failed", { userId: user.id, databaseCode: error.code });
      return NextResponse.json(
        { error: "Verification temporarily unavailable. Please try again." },
        { status: 503, headers: NO_CACHE_HEADERS }
      );
    }
    if (!challenge) {
      return NextResponse.json({ error: "Invalid or expired OTP" }, { status: 400 });
    }

    if (
      !challenge.verified_at &&
      challenge.locked_until &&
      new Date(challenge.locked_until) > now
    ) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait 15 minutes." },
        { status: 429 }
      );
    }

    // Reserve this attempt atomically BEFORE comparing. Counting only failed
    // attempts let parallel guesses all be compared before the counter locked
    // the challenge; now each comparison consumes one of MAX attempts.
    let attemptNumber = 0;
    if (!challenge.verified_at) {
      const { data: rpcResult, error: rpcError } = await adminSupabase.rpc(
        "increment_otp_attempt",
        {
          challenge_id: challenge.id,
          max_attempts: MAX_VERIFY_ATTEMPTS,
          lockout_duration: "15 minutes",
        }
      );

      if (rpcError) {
        log.error("Failed to reserve OTP attempt", {
          challengeId: challenge.id,
          error: rpcError.message,
        });
        return NextResponse.json(
          { error: "Verification temporarily unavailable. Please try again." },
          { status: 503 }
        );
      }

      attemptNumber = rpcResult?.[0]?.new_attempt_count;
      if (attemptNumber == null) {
        // Claimed by a concurrent request.
        return NextResponse.json({ error: "Invalid or expired OTP" }, { status: 400 });
      }
      if (attemptNumber > MAX_VERIFY_ATTEMPTS) {
        return NextResponse.json(
          { error: "Too many attempts. Please wait 15 minutes." },
          { status: 429 }
        );
      }
    }
    if (!(await verifyOtp(otp, challenge.otp_hash))) {
      const locked = attemptNumber >= MAX_VERIFY_ATTEMPTS;
      return NextResponse.json(
        {
          error: locked ? "Too many attempts. Please wait 15 minutes." : "Invalid or expired OTP",
        },
        { status: locked ? 429 : 400 }
      );
    }

    const verificationResult = await finalizePhoneVerification(
      adminSupabase,
      user,
      phone,
      challenge
    );
    if (!verificationResult.success) {
      return NextResponse.json(
        {
          error: verificationResult.error,
          ...(verificationResult.code ? { code: verificationResult.code } : {}),
        },
        {
          status: verificationResult.status,
          headers: {
            ...NO_CACHE_HEADERS,
            ...(verificationResult.retryAfter
              ? { "Retry-After": String(verificationResult.retryAfter) }
              : {}),
          },
        }
      );
    }
    if (verificationResult.alreadyVerified) {
      return NextResponse.json({ success: true, verified: true }, { headers: NO_CACHE_HEADERS });
    }

    // The verified phone is what buyers reach; replacing one is announced to
    // the account email (the SMS below only reaches the new number).
    if (verificationResult.phoneChanged) {
      scheduleBackgroundTask(
        announcePhoneChange(user.id, user.email ?? null, phone),
        "phone change security notice"
      );
    }

    // Non-blocking security confirmation so users can spot unauthorized phone changes.
    scheduleBackgroundTask(
      sendSms({
        to: phone,
        message:
          "VerifyMzansi: Your phone number was verified successfully. If this was not you, contact support immediately.",
      }).catch((smsError) => {
        log.warn("Failed to send post-verification security SMS", {
          userId: user.id,
          error: smsError instanceof Error ? smsError.message : "Unknown error",
        });
      }),
      "phone verification security SMS"
    );

    return NextResponse.json({ success: true, verified: true }, { headers: NO_CACHE_HEADERS });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
