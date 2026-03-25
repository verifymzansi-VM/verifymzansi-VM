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

const log = createLogger("ProfileUpdate");

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

    const parsedBody = await parseAndValidateJsonRequest(request, profileUpdateSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    let normalizedPhone: string | null = null;
    if (parsedBody.data.phone && parsedBody.data.phone !== "") {
      normalizedPhone = normalizeSaPhone(parsedBody.data.phone);
    }

    const updatePayload: Record<string, unknown> = {
      display_name: parsedBody.data.displayName,
      bio: parsedBody.data.bio || null,
      location_province: parsedBody.data.province || null,
      location_city: parsedBody.data.city || null,
    };

    if (typeof parsedBody.data.avatarUrl === "string") {
      updatePayload.avatar_url = parsedBody.data.avatarUrl || null;
    }

    if (parsedBody.data.phone !== undefined) {
      // Stage as pending — canonical phone is only promoted by /api/otp/verify.
      updatePayload.pending_phone = normalizedPhone;
    }

    const { data: updatedProfile, error: updateError } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .update(updatePayload)
      .eq("user_id", user.id)
      .select(
        "id, user_id, display_name, avatar_url, bio, location_province, location_city, account_verification_status, account_status"
      )
      .single();

    if (updateError) {
      if (updateError.code === "23505") {
        return NextResponse.json({ error: ACCOUNT_PHONE_IN_USE_ERROR }, { status: 409 });
      }
      log.error("Profile update failed", { userId: user.id, error: updateError.message });
      return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }

    const res = NextResponse.json({ success: true, profile: updatedProfile });
    // profile-update no longer writes canonical phone, so x-phone-ok is never
    // set here. Clear it only when the user explicitly removed their phone entry
    // (normalizedPhone === null) so the middleware re-checks on the next request.
    if (normalizedPhone === null && parsedBody.data.phone !== undefined) {
      res.cookies.delete("x-phone-ok");
    }
    return res;
  } catch (error) {
    logApiError(log, "Unexpected profile update error", error);
    return internalApiError();
  }
}
