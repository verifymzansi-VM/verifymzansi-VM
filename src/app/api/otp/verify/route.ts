import { NextResponse, type NextRequest } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { otpVerifySchema } from "@/lib/validations/auth";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import {
  ACCOUNT_PHONE_IN_USE_ERROR,
  buildAccountPhoneFields,
  normalizeSaPhone,
} from "@/lib/utils/phone";

const log = createLogger("OTPVerify");
const MAX_VERIFY_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function getDefaultDisplayName(user: { email?: string | null; user_metadata?: unknown }): string {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName = metadata.display_name;
  const fullName = metadata.full_name;

  if (typeof displayName === "string" && displayName.trim().length > 0) {
    return displayName.trim();
  }

  if (typeof fullName === "string" && fullName.trim().length > 0) {
    return fullName.trim();
  }

  if (user.email) {
    return user.email.split("@")[0] || "New Member";
  }

  return "New Member";
}

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
      iterations: 100000,
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
  adminSupabase: ReturnType<typeof createAdminClient>,
  user: { id: string; email?: string | null; user_metadata?: unknown },
  accountPhoneFields: ReturnType<typeof buildAccountPhoneFields>,
  nowIso: string
): Promise<{ success: true } | { success: false; error: string; status: number }> {
  let { data: profile } = await adminSupabase
    .from("account_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) {
    const { data: createdProfile, error: createProfileError } = await adminSupabase
      .from("account_profiles")
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
    const { error: profileUpdateError } = await adminSupabase
      .from("account_profiles")
      .update(accountPhoneFields)
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

  const { error: sessionError } = await adminSupabase.from("verification_sessions").upsert(
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

  return { success: true };
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP to prevent brute-force across multiple OTP challenges
    const ip = getClientIp(request);
    const rl = await checkRateLimit({ key: ip, action: "otp:verify" });
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    const parsed = otpVerifySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { otp } = parsed.data;
    const phone = normalizeSaPhone(parsed.data.phone);
    const accountPhoneFields = buildAccountPhoneFields(phone);
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    // Mark this challenge as verified atomically.
    await adminSupabase
      .from("otp_challenges")
      .update({ verified_at: nowIso })
      .eq("id", challenge.id)
      .is("verified_at", null);

    const verificationResult = await finalizePhoneVerification(
      adminSupabase,
      user,
      accountPhoneFields,
      nowIso
    );
    if (!verificationResult.success) {
      return NextResponse.json(
        { error: verificationResult.error },
        { status: verificationResult.status }
      );
    }

    return NextResponse.json({ success: true, verified: true });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "unknown error" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
