import { NextResponse, type NextRequest } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { otpVerifySchema } from "@/lib/validations/auth";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";

const log = createLogger("OTPVerify");
const MAX_VERIFY_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

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

function normalizeSaPhone(phone: string): string {
  return phone.startsWith("0") ? `+27${phone.slice(1)}` : phone;
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

    // Create or update phone verification step
    const { data: profile } = await adminSupabase
      .from("seller_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (profile) {
      // Save phone number to profile
      await adminSupabase.from("seller_profiles").update({ phone: phone }).eq("id", profile.id);

      const { error: stepsError } = await adminSupabase.from("verification_steps").upsert(
        {
          user_id: user.id,
          step_type: "phone",
          status: "approved",
          phone_verified_at: new Date().toISOString(),
        },
        { onConflict: "user_id,step_type" }
      );

      if (stepsError) {
        log.error("Failed to update verification steps", { error: stepsError.message });
      }
    }

    return NextResponse.json({ success: true, verified: true });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "unknown error" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
