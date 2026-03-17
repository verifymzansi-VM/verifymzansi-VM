import { type NextRequest, NextResponse } from "next/server";
import { profileUpdateSchema } from "@/lib/validations/profile";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { ACCOUNT_PHONE_IN_USE_ERROR, normalizeSaPhone } from "@/lib/utils/phone";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";

const log = createLogger("ProfileUpdate");

export async function POST(request: NextRequest) {
  try {
    const sameOriginFailure = enforceSameOriginMutation(request, log);
    if (sameOriginFailure) {
      return sameOriginFailure;
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

    const admin = createAdminClient();

    let normalizedPhone: string | null = null;
    if (parsedBody.data.phone && parsedBody.data.phone !== "") {
      normalizedPhone = normalizeSaPhone(parsedBody.data.phone);

      const { data: existingPhoneProfile, error: phoneCheckError } = await admin
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .select("user_id")
        .eq("phone", normalizedPhone)
        .neq("user_id", user.id)
        .maybeSingle();

      if (phoneCheckError) {
        log.error("Phone uniqueness check failed", { error: phoneCheckError.message });
        return NextResponse.json(
          { error: "Unable to update profile. Please try again." },
          { status: 500 }
        );
      }

      if (existingPhoneProfile) {
        return NextResponse.json({ error: ACCOUNT_PHONE_IN_USE_ERROR }, { status: 409 });
      }
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
      updatePayload.phone = normalizedPhone;
    }

    const { data: updatedProfile, error: updateError } = await admin
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

    // Set/clear the phone-gate cache cookie so the middleware doesn't
    // need a DB round-trip to verify phone presence on every request.
    const res = NextResponse.json({ success: true, profile: updatedProfile });
    if (normalizedPhone) {
      res.cookies.set("x-phone-ok", "1", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 86400, // 24 hours
        path: "/",
      });
    }
    return res;
  } catch (error) {
    logApiError(log, "Unexpected profile update error", error);
    return internalApiError();
  }
}
