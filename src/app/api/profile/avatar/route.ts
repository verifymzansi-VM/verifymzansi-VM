import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { validateBufferIntegrity } from "@/lib/utils/file-validation";
import { scanForMalware } from "@/lib/utils/malware-scan";
import {
  stripExifFromJpeg,
  stripMetadataFromPng,
  stripMetadataFromWebp,
} from "@/lib/utils/exif-strip";

const log = createLogger("AvatarUpload");

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const BUCKET = "avatars";

export async function POST(request: NextRequest) {
  const sameOriginFailure = enforceSameOriginMutation(request, log);
  if (sameOriginFailure) {
    return sameOriginFailure;
  }
  const csrfBlock = enforceCsrfToken(request, log);
  if (csrfBlock) return csrfBlock;

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

  const userRateCheck = await checkRateLimit({ key: user.id, action: "profile:avatar" });
  if (userRateCheck.limited) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(userRateCheck.retryAfter ?? 60) } }
    );
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

  let admin: ReturnType<typeof createAdminClient> | null = null;
  const getAdmin = () => {
    admin ??= createAdminClient();
    return admin;
  };

  try {
    const arrayBuffer = await file.arrayBuffer();
    let fileBuffer = new Uint8Array(arrayBuffer);

    // ── Server-side magic-byte MIME validation ────────────────
    const integrity = validateBufferIntegrity(fileBuffer, file.type);
    if (!integrity.valid) {
      log.warn("Avatar MIME mismatch", {
        declared: file.type,
        detected: integrity.detectedMime,
        userId: user.id,
      });
      return NextResponse.json(
        { error: "File type does not match its content. Please upload a valid image." },
        { status: 400 }
      );
    }

    // ── Malware scan ──────────────────────────────────────────
    const scanResult = scanForMalware(fileBuffer, file.type);
    if (!scanResult.safe) {
      log.warn("Malware detected in avatar upload", {
        threat: scanResult.threat,
        userId: user.id,
      });
      return NextResponse.json(
        { error: "This file was rejected because it contains suspicious content." },
        { status: 400 }
      );
    }

    // ── Strip metadata (POPIA data minimization) ─────────────
    if (file.type === "image/jpeg" || integrity.detectedMime === "image/jpeg") {
      fileBuffer = new Uint8Array(stripExifFromJpeg(fileBuffer));
    } else if (file.type === "image/png") {
      fileBuffer = new Uint8Array(stripMetadataFromPng(fileBuffer));
    } else if (file.type === "image/webp") {
      fileBuffer = new Uint8Array(stripMetadataFromWebp(fileBuffer));
    }

    const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    const storagePath = `${user.id}/avatar.${ext}`;

    // Upload to Supabase Storage (upsert to overwrite existing avatar)
    const storage = getAdmin().storage;
    const { error: uploadError } = await storage.from(BUCKET).upload(storagePath, fileBuffer, {
      contentType: file.type,
      upsert: true,
    });

    if (uploadError) {
      log.error("Avatar upload failed", { userId: user.id, error: uploadError.message });
      return NextResponse.json({ error: "Failed to upload avatar" }, { status: 500 });
    }

    // Best-effort cleanup of avatars previously uploaded with a different
    // extension (e.g. old PNG when the new one is JPEG) so they don't linger.
    const stalePaths = ["jpg", "png", "webp"]
      .filter((candidate) => candidate !== ext)
      .map((candidate) => `${user.id}/avatar.${candidate}`);
    try {
      await storage.from(BUCKET).remove(stalePaths);
    } catch (cleanupErr) {
      log.warn("Failed to remove stale avatar variants", {
        userId: user.id,
        error: cleanupErr instanceof Error ? cleanupErr.message : "Unknown error",
      });
    }

    // Get the public URL. The storage path is stable across re-uploads, so
    // append a version param to bust CDN/browser caches of the old avatar.
    const {
      data: { publicUrl },
    } = storage.from(BUCKET).getPublicUrl(storagePath);
    const versionedUrl = `${publicUrl}?v=${Date.now()}`;

    // Update profile with avatar URL
    const { error: updateError } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .update({ avatar_url: versionedUrl })
      .eq("user_id", user.id);

    if (updateError) {
      log.error("Avatar URL save failed", { userId: user.id, error: updateError.message });
      return NextResponse.json({ error: "Failed to save avatar" }, { status: 500 });
    }

    return NextResponse.json({ success: true, avatarUrl: versionedUrl });
  } catch (err) {
    log.error("Avatar upload unexpected error", {
      userId: user.id,
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
