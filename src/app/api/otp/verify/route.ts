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
import { sendSms } from "@/lib/services/sms";
import { buildVerificationEmailConfirmationRequiredPayload } from "@/lib/constants/verification-email-confirmation";

const log = createLogger("OTPVerify");
const MAX_VERIFY_ATTEMPTS = 5;
const _LOCKOUT_MS = 15 * 60 * 1000;
const OTP_PBKDF2_ITERATIONS = 100000;
const NO_CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

// Re-exported from shared module
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
  supabase: Awaited<ReturnType<typeof createClient>>,
  adminSupabase: ReturnType<typeof createAdminClient>,
  user: { id: string; email?: string | null; user_metadata?: unknown },
  accountPhoneFields: ReturnType<typeof buildAccountPhoneFields>,
  nowIso: string,
  otpLogLookup: { phone: string; otpHash: string }
): Promise<{ success: true } | { success: false; error: string; status: number }> {
  const ensuredProfile = await ensureAccountProfile(adminSupabase, user);
  if (!ensuredProfile) {
    return {
      success: false,
      error: "Failed to prepare your account profile for phone verification.",
      status: 500,
    };
  }

  const { data: profile } = await supabase
    .from(ACCOUNT_PROFILE_WRITE_TABLE)
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  // Use the user-client profile ID if visible, otherwise fall back to the
  // admin-ensured ID (covers RLS-restricted scenarios).
  const profileId = profile?.id ?? ensuredProfile.id;

  {
    const { error: profileUpdateError } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      // Promote pending_phone to canonical phone, clear staging, and stamp cooldown.
      .update({ ...accountPhoneFields, pending_phone: null, contact_last_phone_change_at: nowIso })
      .eq("id", profileId);

    if (profileUpdateError) {
      if (profileUpdateError.code === "23505") {
        return { success: false, error: ACCOUNT_PHONE_IN_USE_ERROR, status: 409 };
      }

      log.warn(
        "Profile update via user client failed during OTP verification; retrying with admin",
        {
          error: profileUpdateError.message,
          code: profileUpdateError.code,
          userId: user.id,
        }
      );

      const { error: adminProfileUpdateError } = await adminSupabase
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        // Promote pending_phone to canonical phone, clear staging, and stamp cooldown.
        .update({
          ...accountPhoneFields,
          pending_phone: null,
          contact_last_phone_change_at: nowIso,
        })
        .eq("id", profileId)
        .eq("user_id", user.id);

      if (adminProfileUpdateError) {
        if (adminProfileUpdateError.code === "23505") {
          return { success: false, error: ACCOUNT_PHONE_IN_USE_ERROR, status: 409 };
        }

        log.error("Failed to save phone on account profile", {
          error: adminProfileUpdateError.message,
          code: adminProfileUpdateError.code,
          userId: user.id,
        });
        return {
          success: false,
          error: "Failed to save the verified phone number on your account.",
          status: 500,
        };
      }
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
    return {
      success: false,
      error: "Failed to record phone verification. Please try again.",
      status: 500,
    };
  }

  // Session signal columns are service-role only (owner UPDATE policy on
  // verification_sessions was dropped); write phone_verified_at via admin.
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
    return {
      success: false,
      error: "Failed to record phone verification. Please try again.",
      status: 500,
    };
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

async function claimOtpChallenge(
  adminSupabase: ReturnType<typeof createAdminClient>,
  challengeId: string,
  nowIso: string
): Promise<boolean> {
  const builder = adminSupabase
    .from("otp_challenges")
    .update({ verified_at: nowIso })
    .eq("id", challengeId)
    .is("verified_at", null);

  // PostgREST exposes .select() on update builders at runtime even though
  // TypeScript's `.is()` return type omits it.  Use it when available to
  // atomically verify the claimed row; fall back to a plain update otherwise.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectFn = (builder as any).select;
  if (typeof selectFn === "function") {
    const { data, error } = await selectFn.call(builder, "id").maybeSingle();
    if (error) {
      log.warn("Failed to atomically claim OTP challenge", {
        challengeId,
        error: error.message,
      });
      return false;
    }
    return Boolean(data?.id);
  }

  // Fallback: if .select() is unavailable, run the plain update and then
  // re-read with the SAME CAS filter (verified_at stamped by THIS request) to
  // confirm this request — not a concurrent one — claimed the row. Re-reading by
  // id alone would let two concurrent claims both observe verified_at set and
  // both report success (TOCTOU).
  const { error } = await builder;
  if (error) {
    log.warn("Failed to claim OTP challenge", { challengeId, error: error.message });
    return false;
  }

  const { data: claimedRow, error: claimReadError } = await adminSupabase
    .from("otp_challenges")
    .select("id, verified_at")
    .eq("id", challengeId)
    .eq("verified_at", nowIso)
    .maybeSingle();

  if (claimReadError) {
    log.warn("Failed to confirm OTP challenge claim", {
      challengeId,
      error: claimReadError.message,
    });
    return false;
  }

  return Boolean(claimedRow?.id);
}

async function markSiblingChallengesVerified(
  adminSupabase: ReturnType<typeof createAdminClient>,
  userId: string,
  phone: string,
  challengeId: string,
  nowIso: string
): Promise<void> {
  const builder = adminSupabase
    .from("otp_challenges")
    .update({ verified_at: nowIso })
    .eq("user_id", userId)
    .eq("phone", phone)
    .is("verified_at", null);

  // PostgREST exposes .neq() at runtime; use it when available to exclude
  // the already-claimed challenge, otherwise fall back to the plain update.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const neqFn = (builder as any).neq;
  if (typeof neqFn === "function") {
    const { error } = await neqFn.call(builder, "id", challengeId);
    if (error) {
      log.warn("Failed to mark sibling OTP challenges verified", {
        userId,
        challengeId,
        error: error.message,
      });
    }
    return;
  }

  // Fallback: update without the .neq() filter — the already-claimed
  // challenge already has verified_at set so IS NULL excludes it.
  const { error } = await builder;
  if (error) {
    log.warn("Failed to mark sibling OTP challenges verified (fallback)", {
      userId,
      challengeId,
      error: error.message,
    });
  }
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

    if (!user.email_confirmed_at) {
      return NextResponse.json(buildVerificationEmailConfirmationRequiredPayload(), {
        status: 403,
      });
    }

    // If a pending_phone exists, OTP verification must target that exact staged value.
    // This prevents verifying a phone number that was not explicitly staged for this user.
    const { data: profileGuard, error: profileGuardErr } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("pending_phone")
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
      // Atomic increment to avoid read-modify-write race (#39)
      const { data: rpcResult, error: rpcError } = await adminSupabase.rpc(
        "increment_otp_attempt",
        {
          challenge_id: challenge.id,
          max_attempts: MAX_VERIFY_ATTEMPTS,
          lockout_duration: "15 minutes",
        }
      );

      if (rpcError) {
        log.error("Failed to increment OTP attempt counter", {
          challengeId: challenge.id,
          error: rpcError.message,
        });
        return NextResponse.json(
          { error: "Verification temporarily unavailable. Please try again." },
          { status: 503 }
        );
      }

      const locked =
        rpcResult?.[0]?.new_locked_until != null && new Date(rpcResult[0].new_locked_until) > now;

      return NextResponse.json(
        {
          error: locked ? "Too many attempts. Please wait 15 minutes." : "Invalid or expired OTP",
        },
        { status: locked ? 429 : 400 }
      );
    }

    // Atomically claim the challenge to prevent concurrent duplicate verification.
    const claimed = await claimOtpChallenge(adminSupabase, challenge.id, nowIso);
    if (!claimed) {
      return NextResponse.json({ error: "Invalid or expired OTP" }, { status: 400 });
    }

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

    // Best-effort: invalidate sibling pending challenges after successful verification.
    await markSiblingChallengesVerified(adminSupabase, user.id, phone, challenge.id, nowIso);

    // Non-blocking security confirmation so users can spot unauthorized phone changes.
    void sendSms({
      to: phone,
      message:
        "VerifyMzansi: Your phone number was verified successfully. If this was not you, contact support immediately.",
    }).catch((smsError) => {
      log.warn("Failed to send post-verification security SMS", {
        userId: user.id,
        error: smsError instanceof Error ? smsError.message : "Unknown error",
      });
    });

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
