import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteFromR2, getR2ObjectBytes } from "@/lib/services/storage";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { detectMimeFromMagicBytes } from "@/lib/utils/file-validation";
import { scanForMalware } from "@/lib/utils/malware-scan";
import { createLogger } from "@/lib/utils/logger";
import { UPLOAD_AREAS } from "@/types/enums";

const log = createLogger("MediaUploadComplete");

const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

const uploadCompleteSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "key is required")
    .max(1024, "key is too long")
    .regex(/^[\w\-/.]+$/, "key contains invalid characters")
    .refine((key) => !key.includes(".."), "key contains invalid path segments"),
  publicUrl: z.string().trim().url("publicUrl must be a valid URL"),
  contentType: z.string().trim().min(1, "contentType is required"),
  size: z.coerce.number().int().positive("size must be a positive number"),
  area: z.enum(UPLOAD_AREAS).optional().default("listing"),
});

type MediaUploadRow = {
  bucket: string;
  r2_key: string;
  url: string;
  content_type: string | null;
  file_size: number | null;
  area: string | null;
};

async function cleanupRejectedUpload({
  bucket,
  key,
  userId,
  publicUrl,
  reason,
}: {
  bucket: string;
  key: string;
  userId: string;
  publicUrl: string;
  reason: string;
}) {
  try {
    await deleteFromR2(bucket, key);
  } catch (error) {
    log.warn("Failed to delete rejected direct upload from R2", {
      key,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await createAdminClient()
      .from("media_uploads")
      .delete()
      .eq("user_id", userId)
      .eq("r2_key", key)
      .eq("url", publicUrl);
  } catch (error) {
    log.warn("Failed to delete rejected direct upload tracking row", {
      key,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function POST(request: NextRequest) {
  const traceId = crypto.randomUUID();
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;

    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateCheck = await checkRateLimit({
      key: user.id,
      action: "media:upload-complete",
      deviceId: getClientIp(request),
    });

    if (rateCheck.limited) {
      return NextResponse.json(
        { error: "Too many upload verification attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    const parsedBody = await parseAndValidateJsonRequest(request, uploadCompleteSchema, {
      invalidJsonMessage: "Invalid JSON body",
      validationErrorMessage: "Validation failed",
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const { key, publicUrl, contentType, size, area } = parsedBody.data;

    if (!VIDEO_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: `Unsupported content type. Must be one of: ${[...VIDEO_TYPES].join(", ")}` },
        { status: 400 }
      );
    }

    if (size > MAX_VIDEO_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum video size is 50 MB." },
        { status: 400 }
      );
    }

    const { data: row, error: rowError } = (await supabase
      .from("media_uploads")
      .select("bucket,r2_key,url,content_type,file_size,area")
      .eq("user_id", user.id)
      .eq("r2_key", key)
      .eq("url", publicUrl)
      .maybeSingle()) as { data: MediaUploadRow | null; error: { message?: string } | null };

    if (rowError) {
      log.error("Failed to load direct upload tracking row", {
        traceId,
        userId: user.id,
        key,
        error: rowError.message,
      });
      return NextResponse.json(
        { error: "Failed to verify upload", code: "upload_tracking_lookup_failed", traceId },
        { status: 500, headers: { "x-upload-trace-id": traceId } }
      );
    }

    if (!row) {
      return NextResponse.json(
        { error: "Upload tracking row was not found", code: "upload_tracking_missing", traceId },
        { status: 404, headers: { "x-upload-trace-id": traceId } }
      );
    }

    if (row.content_type !== contentType || row.file_size !== size || row.area !== area) {
      await cleanupRejectedUpload({
        bucket: row.bucket,
        key,
        userId: user.id,
        publicUrl,
        reason: "tracking_mismatch",
      });
      return NextResponse.json(
        { error: "Upload metadata mismatch", code: "upload_metadata_mismatch", traceId },
        { status: 400, headers: { "x-upload-trace-id": traceId } }
      );
    }

    const object = await getR2ObjectBytes(row.bucket, key);
    if (!object) {
      await cleanupRejectedUpload({
        bucket: row.bucket,
        key,
        userId: user.id,
        publicUrl,
        reason: "object_missing",
      });
      return NextResponse.json(
        { error: "Uploaded object was not found", code: "uploaded_object_missing", traceId },
        { status: 404, headers: { "x-upload-trace-id": traceId } }
      );
    }

    if (object.contentLength != null && object.contentLength !== size) {
      await cleanupRejectedUpload({
        bucket: row.bucket,
        key,
        userId: user.id,
        publicUrl,
        reason: "size_mismatch",
      });
      return NextResponse.json(
        { error: "Uploaded object size mismatch", code: "uploaded_object_size_mismatch", traceId },
        { status: 400, headers: { "x-upload-trace-id": traceId } }
      );
    }

    if (object.bytes.byteLength !== size) {
      await cleanupRejectedUpload({
        bucket: row.bucket,
        key,
        userId: user.id,
        publicUrl,
        reason: "body_size_mismatch",
      });
      return NextResponse.json(
        {
          error: "Uploaded object body size mismatch",
          code: "uploaded_object_size_mismatch",
          traceId,
        },
        { status: 400, headers: { "x-upload-trace-id": traceId } }
      );
    }

    const detectedMime = detectMimeFromMagicBytes(object.bytes.slice(0, 12));
    if (detectedMime !== contentType) {
      await cleanupRejectedUpload({
        bucket: row.bucket,
        key,
        userId: user.id,
        publicUrl,
        reason: "mime_mismatch",
      });
      return NextResponse.json(
        {
          error: "Uploaded object content does not match declared video type",
          code: "uploaded_object_mime_mismatch",
          traceId,
        },
        { status: 400, headers: { "x-upload-trace-id": traceId } }
      );
    }

    const scanResult = scanForMalware(object.bytes, contentType);
    if (!scanResult.safe) {
      await cleanupRejectedUpload({
        bucket: row.bucket,
        key,
        userId: user.id,
        publicUrl,
        reason: scanResult.threat ?? "malware_scan_failed",
      });
      return NextResponse.json(
        {
          error: "Uploaded object failed security validation",
          code: "uploaded_object_rejected",
          traceId,
        },
        { status: 400, headers: { "x-upload-trace-id": traceId } }
      );
    }

    // All validation passed — persist the validated marker. Only validated
    // uploads may be attached to content (enforced by confirmMediaUploads).
    // Service-role client: media_uploads has no user UPDATE RLS policy.
    const { error: validatedError } = await createAdminClient()
      .from("media_uploads")
      .update({ validated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("r2_key", key)
      .is("validated_at", null);

    if (validatedError) {
      log.error("Failed to persist upload validation marker", {
        traceId,
        userId: user.id,
        key,
        error: validatedError.message,
      });
      return NextResponse.json(
        { error: "Failed to finalize upload", code: "upload_validation_persist_failed", traceId },
        { status: 500, headers: { "x-upload-trace-id": traceId } }
      );
    }

    return NextResponse.json({ success: true, publicUrl });
  } catch (error) {
    log.error("Unexpected direct upload completion failure", {
      traceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to verify upload", code: "upload_completion_failed", traceId },
      { status: 500, headers: { "x-upload-trace-id": traceId } }
    );
  }
}
