import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

const log = createLogger("AvatarUpload");

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const BUCKET = "avatars";

export async function POST(request: NextRequest) {
  // Rate limit by IP
  const ip = getClientIp(request);
  const rateCheck = await checkRateLimit({ key: ip, action: "profile:avatar" });
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

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Validate file type
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Invalid file type. Allowed: JPEG, PNG, WebP." },
      { status: 400 }
    );
  }

  // Validate file size
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large. Maximum size is 2 MB." }, { status: 400 });
  }

  const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
  const storagePath = `${user.id}/avatar.${ext}`;

  const admin = createAdminClient();

  try {
    // Upload to Supabase Storage (upsert to overwrite existing avatar)
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, arrayBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      log.error("Avatar upload failed", { userId: user.id, error: uploadError.message });
      return NextResponse.json({ error: "Failed to upload avatar" }, { status: 500 });
    }

    // Get the public URL
    const {
      data: { publicUrl },
    } = admin.storage.from(BUCKET).getPublicUrl(storagePath);

    // Update profile with avatar URL
    const { error: updateError } = await admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .update({ avatar_url: publicUrl })
      .eq("user_id", user.id);

    if (updateError) {
      log.error("Avatar URL save failed", { userId: user.id, error: updateError.message });
      return NextResponse.json({ error: "Failed to save avatar" }, { status: 500 });
    }

    return NextResponse.json({ success: true, avatarUrl: publicUrl });
  } catch (err) {
    log.error("Avatar upload unexpected error", {
      userId: user.id,
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
