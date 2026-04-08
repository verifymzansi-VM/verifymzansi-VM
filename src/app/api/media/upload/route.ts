import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadToR2, generateStorageKey, deleteFromR2 } from "@/lib/services/storage";
import { createLogger } from "@/lib/utils/logger";
import { UPLOAD_AREAS } from "@/types/enums";
import { ACCOUNT_PROFILE_NOT_FOUND_ERROR, ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";
import { ensureAccountProfile } from "@/lib/account/ensure-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { detectMimeFromMagicBytes } from "@/lib/utils/file-validation";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { stripExifFromJpeg, stripMetadataFromPng } from "@/lib/utils/exif-strip";
import { scanForMalware } from "@/lib/utils/malware-scan";
import { parseAndValidateFormData } from "@/lib/utils/api";
import { z } from "zod";

const log = createLogger("MediaUpload");

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_FILES = 10;

/** Map of allowed file extensions to their expected MIME types */
const EXTENSION_MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
};
const mediaUploadMetadataSchema = z.object({
  area: z.enum(UPLOAD_AREAS).default("listing"),
});

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

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

/** Lightweight health-check for upload preflight. */
export function HEAD() {
  return new NextResponse(null, { status: 200 });
}

export async function POST(request: NextRequest) {
  try {
    const sameOriginFailure = enforceSameOriginMutation(request, log);
    if (sameOriginFailure) {
      return sameOriginFailure;
    }

    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

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

    let admin: ReturnType<typeof createAdminClient> | null = null;
    const getAdmin = () => {
      admin ??= createAdminClient();
      return admin;
    };

    // ── Get account profile ──────────────────────────────────
    const { data: profile, error: profileError } = await supabase
      .from(ACCOUNT_PROFILE_TABLE)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      log.error("Failed to fetch account profile", {
        userId: user.id,
        error: profileError.message,
      });
      return NextResponse.json({ error: "Unable to verify account" }, { status: 500 });
    }

    if (!profile) {
      const autoProfile = await ensureAccountProfile(getAdmin(), user);
      if (!autoProfile) {
        return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
      }
    }

    // ── Parse form data ──────────────────────────────────────
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const metadata = parseAndValidateFormData(formData, mediaUploadMetadataSchema, {
      validationErrorMessage: `Invalid area. Must be one of: ${UPLOAD_AREAS.join(", ")}`,
      includeValidationDetails: false,
    });
    if (!metadata.success) {
      return metadata.response;
    }
    const { area } = metadata.data;

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
    let hadUploadFailure = false;

    for (const file of files) {
      const isImage = IMAGE_TYPES.has(file.type);
      const isVideo = VIDEO_TYPES.has(file.type);

      if (!isImage && !isVideo) {
        errors.push(`"${file.name}": unsupported file type`);
        continue;
      }

      // Cross-validate file extension against declared MIME type.
      // Android content-picker files may have no extension (e.g. "1000061870")
      // — skip the extension check for those and rely on magic-byte validation below.
      const hasExtension = file.name.includes(".");
      if (hasExtension) {
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        const expectedMime = EXTENSION_MIME_MAP[ext];
        if (!expectedMime || expectedMime !== file.type) {
          errors.push(`"${file.name}": file extension does not match declared type`);
          continue;
        }
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

      // Scan for embedded malware / polyglot attacks
      const fileBuffer = new Uint8Array(await file.arrayBuffer());
      const scanResult = scanForMalware(fileBuffer, file.type);
      if (!scanResult.safe) {
        log.warn("Malware scan rejected upload", {
          filename: file.name,
          threat: scanResult.threat,
          userId: user.id,
        });
        errors.push(`"${file.name}": file rejected by security scan`);
        continue;
      }

      const key = generateStorageKey(`media/${area}`, user.id, file.name);

      try {
        // Strip metadata from images to prevent GPS/PII leaks (POPIA)
        let uploadFile: File | Blob = file;
        if (file.type === "image/jpeg") {
          const stripped = stripExifFromJpeg(fileBuffer);
          uploadFile = new Blob([toArrayBuffer(stripped)], { type: file.type });
        } else if (file.type === "image/png") {
          const stripped = stripMetadataFromPng(fileBuffer);
          uploadFile = new Blob([toArrayBuffer(stripped)], { type: file.type });
        }

        const result = await uploadToR2({
          bucket,
          key,
          file: uploadFile,
          contentType: file.type,
        });
        uploadedUrls.push(result.url);

        // Track upload for orphan detection — blocking to ensure R2/DB consistency
        const { error: trackErr } = await supabase.from("media_uploads").insert({
          user_id: user.id,
          r2_key: key,
          bucket,
          url: result.url,
          content_type: file.type,
          file_size: file.size,
          area,
        });

        if (trackErr) {
          log.error("Failed to track media upload — cleaning up orphaned R2 object", {
            key,
            error: trackErr.message,
            userId: user.id,
          });
          // Remove the R2 object to prevent orphans without DB records
          try {
            await deleteFromR2(bucket, key);
          } catch (cleanupErr) {
            log.error("Failed to clean up orphaned R2 object", {
              key,
              error: cleanupErr instanceof Error ? cleanupErr.message : "Unknown",
            });
          }
          errors.push(`"${file.name}": upload tracking failed`);
          continue;
        }
      } catch (err) {
        log.error(`Failed to upload ${file.name}`, { error: err });
        hadUploadFailure = true;
        errors.push(`"${file.name}": upload failed`);
      }
    }

    const hasErrors = errors.length > 0;
    const allFailed = hasErrors && uploadedUrls.length === 0;

    return NextResponse.json(
      {
        success: !hasErrors,
        urls: uploadedUrls,
        errors: hasErrors ? errors : undefined,
      },
      { status: allFailed ? (hadUploadFailure ? 500 : 400) : hasErrors ? 207 : 200 }
    );
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "Unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to upload media" }, { status: 500 });
  }
}
