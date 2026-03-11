import { type NextRequest, NextResponse } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { profileUpdateSchema } from "@/lib/validations/profile";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { ACCOUNT_PHONE_IN_USE_ERROR, normalizeSaPhone } from "@/lib/utils/phone";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

const log = createLogger("ProfileUpdate");

export async function POST(request: NextRequest) {
  // Rate limit by IP
  const ip = getClientIp(request);
  const rateCheck = await checkRateLimit({ key: ip, action: "profile:update" });
  if (rateCheck.limited) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
    );
  }

  // Authenticate
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // Parse and validate
  const body = await parseJsonRequest(request);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = profileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // If phone provided, check uniqueness (excluding own profile)
  let normalizedPhone: string | null = null;
  if (parsed.data.phone && parsed.data.phone !== "") {
    normalizedPhone = normalizeSaPhone(parsed.data.phone);

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

  // Build the update payload
  // Note: DB trigger sync_seller_profile_phone_fields handles phone normalization + masked_phone_public
  const updatePayload: Record<string, unknown> = {
    display_name: parsed.data.displayName,
    bio: parsed.data.bio || null,
    location_province: parsed.data.province || null,
    location_city: parsed.data.city || null,
  };

  // Only set phone if it was provided (to avoid clearing it unintentionally)
  if (parsed.data.phone !== undefined) {
    updatePayload.phone = normalizedPhone;
  }

  const { data: updatedProfile, error: updateError } = await admin
    .from(ACCOUNT_PROFILE_WRITE_TABLE)
    .update(updatePayload)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (updateError) {
    // Handle unique constraint violation (race condition safety net)
    if (updateError.code === "23505") {
      return NextResponse.json({ error: ACCOUNT_PHONE_IN_USE_ERROR }, { status: 409 });
    }
    log.error("Profile update failed", { userId: user.id, error: updateError.message });
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }

  return NextResponse.json({ success: true, profile: updatedProfile });
}
