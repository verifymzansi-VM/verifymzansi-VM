import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadToR2, generateStorageKey } from "@/lib/services/storage";
import { createLogger } from "@/lib/utils/logger";
import { UPLOAD_AREAS } from "@/types/enums";
import { ACCOUNT_PROFILE_NOT_FOUND_ERROR } from "@/lib/account/compat";
import { detectMimeFromMagicBytes } from "@/lib/utils/file-validation";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";

const log = createLogger("MediaUpload");

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_FILES = 10;

/**
 * POST /api/media/upload
 *
 * Upload one or more media files (images/videos) for listings,
 * business ads, or mall shops.
 *
 * Accepts multipart/form-data with:
 * - files: one or more media files
 * - area: one of UPLOAD_AREAS (see @/types/enums)
 */
export async function POST(request: NextRequest) {
  try {
    // ── Authenticate ─────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip =
      typeof (request as { headers?: { get?: unknown } }).headers?.get === "function"
        ? getClientIp(request)
        : "unknown";
    const rateCheck = await checkRateLimit({
      key: user.id,
      action: "media:upload",
      deviceId: ip,
    });

    if (rateCheck.limited) {
      return NextResponse.json(
        { error: "Too many upload attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    // ── Get account profile ──────────────────────────────────
    const { data: profile } = await supabase
      .from("account_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
    }

    // ── Parse form data ──────────────────────────────────────
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const area = (formData.get("area") as string) || "listing";
    if (!(UPLOAD_AREAS as readonly string[]).includes(area)) {
      return NextResponse.json(
        { error: `Invalid area. Must be one of: ${UPLOAD_AREAS.join(", ")}` },
        { status: 400 }
      );
    }

    // Collect all files from the form data
    const files: File[] = [];
    const entries = formData.getAll("files");
    for (const value of entries) {
      if (value instanceof File && value.size > 0) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Maximum of ${MAX_FILES} files allowed per upload` },
        { status: 400 }
      );
    }

    // ── Validate & upload each file ──────────────────────────
    const bucket = process.env.R2_PUBLIC_BUCKET || "verifymzansi-public";
    const uploadedUrls: string[] = [];
    const errors: string[] = [];

    for (const file of files) {
      const isImage = IMAGE_TYPES.has(file.type);
      const isVideo = VIDEO_TYPES.has(file.type);

      if (!isImage && !isVideo) {
        errors.push(`"${file.name}": unsupported file type`);
        continue;
      }

      // Validate magic bytes to prevent MIME spoofing (stored XSS)
      const headerSlice = file.slice(0, 12);
      const headerBytes = new Uint8Array(await headerSlice.arrayBuffer());
      const detectedMime = detectMimeFromMagicBytes(headerBytes);
      // Require magic bytes to match for both images and videos
      if (isImage && (!detectedMime || !IMAGE_TYPES.has(detectedMime))) {
        errors.push(`"${file.name}": file content does not match declared type`);
        continue;
      }
      if (isVideo && detectedMime !== null && !VIDEO_TYPES.has(detectedMime)) {
        // If we detected a non-video type (e.g. image or PDF disguised as video), reject.
        errors.push(`"${file.name}": file content does not match declared video type`);
        continue;
      }
      if (isVideo && detectedMime === null) {
        // Reject uploads where MIME cannot be verified for video files
        log.warn("Rejected video upload with undetectable MIME", { filename: file.name });
        errors.push(`"${file.name}": unable to verify video file type`);
        continue;
      }

      const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
      if (file.size > maxSize) {
        errors.push(`"${file.name}": exceeds ${isVideo ? "50 MB" : "5 MB"} limit`);
        continue;
      }

      const key = generateStorageKey(`media/${area}`, user.id, file.name);

      try {
        const result = await uploadToR2({
          bucket,
          key,
          file,
          contentType: file.type,
        });
        uploadedUrls.push(result.url);
      } catch (err) {
        log.error(`Failed to upload ${file.name}`, { error: err });
        errors.push(`"${file.name}": upload failed`);
      }
    }

    return NextResponse.json({
      success: true,
      urls: uploadedUrls,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to upload media" }, { status: 500 });
  }
}
