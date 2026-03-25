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
import {
  ACCOUNT_PHONE_IN_USE_ERROR,
  buildAccountPhoneFields,
  normalizeSaPhone,
} from "@/lib/utils/phone";

const log = createLogger("OTPVerify");
const MAX_VERIFY_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// Re-exported from shared module
import { getDefaultDisplayName } from "@/lib/account/ensure-profile";

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
      iterations: 150000,
      hash: "SHA-512",
    },
    keyMaterial,
    512
  );
  const otpHashHex = toHex(new Uint8Array(derivedBits));

  // Timing-safe comparison
  if (hash.length !== otpHashHex.length) return false;
  const a = fromHex(hash);
  const b = fromHex(otpHashHex);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function finalizePhoneVerification(
  supabase: Awaited<ReturnType<typeof createClient>>,
  adminSupabase: ReturnType<typeof createAdminClient>,
  user: { id: string; email?: string | null; user_metadata?: unknown },
  accountPhoneFields: ReturnType<typeof buildAccountPhoneFields>,
  nowIso: string,
  otpLogLookup: { phone: string; otpHash: string }
): Promise<{ success: true } | { success: false; error: string; status: number }> {
  let { data: profile } = await supabase
    .from(ACCOUNT_PROFILE_WRITE_TABLE)
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) {
    const { data: createdProfile, error: createProfileError } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .upsert(
        {
          user_id: user.id,
          display_name: getDefaultDisplayName(user),
          ...accountPhoneFields,
        },
        { onConflict: "user_id" }
      )
      .select("id")
      .single();

    if (createProfileError) {
      if (createProfileError.code === "23505") {
        return { success: false, error: ACCOUNT_PHONE_IN_USE_ERROR, status: 409 };
      }

      log.error("Failed to auto-create account profile during OTP verification", {
        error: createProfileError.message,
        userId: user.id,
      });
      return {
        success: false,
        error: "Failed to save the verified phone number on your account.",
        status: 500,
      };
    }

    profile = createdProfile;
  }

  if (profile) {
    const { error: profileUpdateError } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      // Promote pending_phone to canonical phone and clear the staging column.
      .update({ ...accountPhoneFields, pending_phone: null })
      .eq("id", profile.id);

    if (profileUpdateError) {
      if (profileUpdateError.code === "23505") {
        return { success: false, error: ACCOUNT_PHONE_IN_USE_ERROR, status: 409 };
      }

      log.error("Failed to save phone on account profile", {
        error: profileUpdateError.message,
        userId: user.id,
      });
      return {
        success: false,
        error: "Failed to save the verified phone number on your account.",
        status: 500,
      };
    }
  }

  const { error: stepsError } = await adminSupabase.from("verification_steps").upsert(
    {
      user_id: user.id,
      step_type: "phone",
      status: "approved",
      phone_verified_at: nowIso,
    },
    { onConflict: "user_id,step_type" }
  );

  if (stepsError) {
    log.error("Failed to update verification steps", { error: stepsError.message });
  }

  const { error: sessionError } = await supabase.from("verification_sessions").upsert(
    {
      user_id: user.id,
      phone_verified_at: nowIso,
    },
    { onConflict: "user_id" }
  );

  if (sessionError) {
    log.error("Failed to update verification session phone state", {
      error: sessionError.message,
    });
  }

  const { error: otpLogError } = await adminSupabase
    .from("otp_logs")
    .update({ verified: true, verified_at: nowIso })
    .eq("phone", otpLogLookup.phone)
    .eq("otp_hash", otpLogLookup.otpHash)
    .is("verified_at", null);

  if (otpLogError) {
    log.warn("Failed to sync OTP audit log verification state", {
      error: otpLogError.message,
      userId: user.id,
    });
  }

  return { success: true };
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
    const accountPhoneFields = buildAccountPhoneFields(phone);
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // If a pending_phone exists, OTP verification must target that exact staged value.
    // This prevents verifying a phone number that was not explicitly staged for this user.
    const { data: profileGuard } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("pending_phone")
      .eq("user_id", user.id)
      .maybeSingle();

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
      .select("id, otp_hash, attempt_count, locked_until, expires_at")
      .eq("user_id", user.id)
      .eq("phone", phone)
      .is("verified_at", null)
      .gte("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !challenge) {
      return NextResponse.json({ error: "Invalid or expired OTP" }, { status: 400 });
    }

    if (challenge.locked_until && new Date(challenge.locked_until) > now) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait 15 minutes." },
        { status: 429 }
      );
    }

    // Find matching OTP by verifying hash
    if (!(await verifyOtp(otp, challenge.otp_hash))) {
      const attemptCount = (challenge.attempt_count || 0) + 1;
      const lockUntil =
        attemptCount >= MAX_VERIFY_ATTEMPTS
          ? new Date(Date.now() + LOCKOUT_MS).toISOString()
          : null;

      await adminSupabase
        .from("otp_challenges")
        .update({
          attempt_count: attemptCount,
          ...(lockUntil ? { locked_until: lockUntil } : {}),
        })
        .eq("id", challenge.id)
        .is("verified_at", null);

      return NextResponse.json(
        {
          error: lockUntil
            ? "Too many attempts. Please wait 15 minutes."
            : "Invalid or expired OTP",
        },
        { status: lockUntil ? 429 : 400 }
      );
    }

    // Mark ALL pending challenges for this user+phone as verified so older
    // OTPs cannot be replayed after a newer one succeeds.
    await adminSupabase
      .from("otp_challenges")
      .update({ verified_at: nowIso })
      .eq("user_id", user.id)
      .eq("phone", phone)
      .is("verified_at", null);

    const verificationResult = await finalizePhoneVerification(
      supabase,
      adminSupabase,
      user,
      accountPhoneFields,
      nowIso,
      { phone, otpHash: challenge.otp_hash }
    );
    if (!verificationResult.success) {
      return NextResponse.json(
        { error: verificationResult.error },
        { status: verificationResult.status }
      );
    }

    return NextResponse.json({ success: true, verified: true });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
