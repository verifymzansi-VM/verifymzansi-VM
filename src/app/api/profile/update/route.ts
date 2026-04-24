import { type NextRequest, NextResponse } from "next/server";
import { profileUpdateSchema } from "@/lib/validations/profile";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { ACCOUNT_PHONE_IN_USE_ERROR, normalizeSaPhone } from "@/lib/utils/phone";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import {
  checkCooldown,
  PHONE_CHANGE_COOLDOWN_MS,
  phoneCooldown,
  phoneReverificationRequired,
} from "@/lib/account/identity-policy";

const log = createLogger("ProfileUpdate");

const PROFILE_POLICY_SELECT =
  "legal_name_locked_at, location_verified_at, account_verification_status, phone, contact_last_phone_change_at";
const PROFILE_POLICY_LEGACY_SELECT = "account_verification_status, phone";

function isMissingPolicyColumnError(error: {
  code?: string;
  message?: string;
  details?: string;
}): boolean {
  const combined =
    `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return (
    combined.includes("pgrst204") ||
    combined.includes("42703") ||
    (combined.includes("column") && combined.includes("does not exist")) ||
    combined.includes("schema cache")
  );
}

export async function POST(request: NextRequest) {
  try {
    const sameOriginFailure = enforceSameOriginMutation(request, log);
    if (sameOriginFailure) {
      return sameOriginFailure;
    }

    const csrfFailure = enforceCsrfToken(request, log);
    if (csrfFailure) {
      return csrfFailure;
    }

    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({ key: ip, action: "profile:update" });
    if (rateCheck.limited) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Secondary user-scoped rate limit to prevent bypass via IP rotation
    const userRateCheck = await checkRateLimit({
      key: user.id,
      action: "profile:update",
    });
    if (userRateCheck.limited) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(userRateCheck.retryAfter ?? 60) } }
      );
    }

    const parsedBody = await parseAndValidateJsonRequest(request, profileUpdateSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    // ── Fetch current profile for policy enforcement ─────────────────
    const { data: currentProfile, error: profileFetchError } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select(PROFILE_POLICY_SELECT)
      .eq("user_id", user.id)
      .maybeSingle();

    let policyProfile = currentProfile;

    if (profileFetchError && isMissingPolicyColumnError(profileFetchError)) {
      log.warn("Falling back to legacy profile policy select", {
        userId: user.id,
        error: profileFetchError.message,
      });

      const { data: legacyProfile, error: legacyFetchError } = await supabase
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .select(PROFILE_POLICY_LEGACY_SELECT)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!legacyFetchError) {
        policyProfile = {
          legal_name_locked_at: null,
          location_verified_at: null,
          account_verification_status: legacyProfile?.account_verification_status ?? null,
          phone: legacyProfile?.phone ?? null,
          contact_last_phone_change_at: null,
        };
      } else {
        log.error("Failed legacy fallback profile fetch for policy check", {
          userId: user.id,
          error: legacyFetchError.message,
        });
        return internalApiError();
      }
    } else if (profileFetchError) {
      log.error("Failed to fetch profile for policy check", {
        userId: user.id,
        error: profileFetchError.message,
      });
      return internalApiError();
    }

    const requestedPhone = parsedBody.data.phone;
    const normalizedPhone =
      requestedPhone === undefined
        ? undefined
        : requestedPhone === ""
          ? null
          : normalizeSaPhone(requestedPhone);
    const currentCanonicalPhone = policyProfile?.phone
      ? normalizeSaPhone(policyProfile.phone)
      : null;
    const phoneChanged =
      requestedPhone !== undefined && (normalizedPhone ?? null) !== (currentCanonicalPhone ?? null);

    // ── Phone-change policy enforcement ───────────────────────────────
    // Only enforced when the canonical phone value is actually changing.
    // First-time phone setup via OTP is always permitted.
    if (phoneChanged && policyProfile?.phone) {
      // Must be fully verified before changing a canonical phone
      if (policyProfile.account_verification_status !== "verified") {
        const policyErr = phoneReverificationRequired();
        return NextResponse.json(
          { error: policyErr.message, code: policyErr.code },
          { status: 403 }
        );
      }
      // 15-day cooldown since last successful phone change
      const cooldownUntil = checkCooldown(
        policyProfile.contact_last_phone_change_at,
        PHONE_CHANGE_COOLDOWN_MS
      );
      if (cooldownUntil) {
        const policyErr = phoneCooldown(cooldownUntil);
        return NextResponse.json(
          { error: policyErr.message, code: policyErr.code, retryAfter: policyErr.retryAfter },
          { status: 429 }
        );
      }
    }

    // ── Build update payload (skip locked fields) ─────────────────────
    // Locked fields are silently excluded so a user saving only their bio
    // is never blocked by locks set on other fields.  The DB trigger
    // provides defence-in-depth against direct bypass attempts.
    const updatePayload: Record<string, unknown> = {
      bio: parsedBody.data.bio || null,
    };

    // display_name: writable only before legal name is locked from verified ID
    if (!policyProfile?.legal_name_locked_at) {
      updatePayload.display_name = parsedBody.data.displayName;
    }

    // location: writable only before location is verified
    if (!policyProfile?.location_verified_at) {
      updatePayload.location_province = parsedBody.data.province || null;
      updatePayload.location_city = parsedBody.data.city || null;
    }

    if (typeof parsedBody.data.avatarUrl === "string") {
      updatePayload.avatar_url = parsedBody.data.avatarUrl || null;
    }

    if (phoneChanged) {
      // Stage as pending — canonical phone is only promoted by /api/otp/verify.
      updatePayload.pending_phone = normalizedPhone ?? null;
    }

    const { data: updatedProfile, error: updateError } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .update(updatePayload)
      .eq("user_id", user.id)
      .select(
        "id, user_id, display_name, avatar_url, bio, location_province, location_city, account_verification_status, account_status"
      )
      .maybeSingle();

    if (updateError) {
      if (updateError.code === "23505") {
        return NextResponse.json({ error: ACCOUNT_PHONE_IN_USE_ERROR }, { status: 409 });
      }
      // DB trigger fired — identity lock bypass attempt
      if (updateError.code === "P0001") {
        return NextResponse.json(
          {
            error: "One or more fields cannot be changed after identity verification.",
            code: "POLICY_VIOLATION",
          },
          { status: 403 }
        );
      }
      log.error("Profile update failed", { userId: user.id, error: updateError.message });
      return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }

    if (!updatedProfile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const res = NextResponse.json({ success: true, profile: updatedProfile });
    // profile-update no longer writes canonical phone, so x-phone-ok is never
    // set here. Clear it only when the user explicitly removed their phone entry
    // (normalizedPhone === null) so the middleware re-checks on the next request.
    if (phoneChanged && normalizedPhone === null) {
      res.cookies.delete("x-phone-ok");
    }
    return res;
  } catch (error) {
    logApiError(log, "Unexpected profile update error", error);
    return internalApiError();
  }
}
