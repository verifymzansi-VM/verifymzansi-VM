import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { generateStorageKey, generatePresignedUploadUrl } from "@/lib/services/storage";
import { createLogger } from "@/lib/utils/logger";
import { ACCOUNT_PROFILE_NOT_FOUND_ERROR, ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";
import { ensureAccountProfile } from "@/lib/account/ensure-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { UPLOAD_AREAS } from "@/types/enums";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";

const log = createLogger("MediaUploadUrl");

const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB
const VIDEO_EXTENSIONS_BY_TYPE: Record<string, string[]> = {
  "video/mp4": ["mp4"],
  "video/webm": ["webm"],
};

const uploadUrlRequestSchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1, "filename is required")
      .max(255, "filename is too long")
      .regex(/^[^\\/\x00-\x1f]+$/, "filename contains invalid characters"),
    contentType: z.string().trim().min(1, "contentType is required"),
    size: z.coerce.number().int().positive("size must be a positive number"),
    area: z.enum(UPLOAD_AREAS).optional().default("listing"),
  })
  .superRefine((value, ctx) => {
    const extension = value.filename.split(".").pop()?.trim().toLowerCase();
    if (!extension) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filename"],
        message: "filename must include a valid video extension",
      });
      return;
    }

    const allowedExtensions = VIDEO_EXTENSIONS_BY_TYPE[value.contentType];
    if (allowedExtensions && !allowedExtensions.includes(extension)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filename"],
        message: `filename extension must match ${value.contentType}`,
      });
    }
  });

/**
 * POST /api/media/upload-url
 *
 * Returns a presigned R2 upload URL for direct client-to-R2 video uploads.
 * This avoids proxying large video files through the server.
 *
 * Request body (JSON):
 * - filename: string (original filename for extension extraction)
 * - contentType: string (MIME type, must be a video type)
 * - size: number (file size in bytes, for validation)
 * - area: string (one of UPLOAD_AREAS)
 *
 * Response:
 * - uploadUrl: string (presigned PUT URL for direct upload to R2)
 * - key: string (storage key for database reference)
 * - publicUrl: string (CDN URL for the uploaded file)
 */
export async function POST(request: NextRequest) {
  const traceId = crypto.randomUUID();
  try {
    const hasRequestContext =
      typeof request.url === "string" &&
      request.headers &&
      typeof request.headers.get === "function";

    if (hasRequestContext) {
      const originBlock = enforceSameOriginMutation(request, log);
      if (originBlock) {
        return originBlock;
      }
      const csrfBlock = enforceCsrfToken(request, log);
      if (csrfBlock) return csrfBlock;
    }

    // ── Authenticate ─────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: user.id,
      action: "media:upload-url",
      deviceId: ip,
    });

    if (rateCheck.limited) {
      return NextResponse.json(
        { error: "Too many upload URL requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    let admin: ReturnType<typeof createAdminClient> | null = null;
    const getAdmin = () => {
      admin ??= createAdminClient();
      return admin;
    };

    // ── Get account profile ──────────────────────────────────
    let { data: profile, error: profileError } = await supabase
      .from(ACCOUNT_PROFILE_TABLE)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      log.error("Failed to fetch account profile for upload URL", {
        error: profileError.message,
        userId: user.id,
      });
      return NextResponse.json({ error: "Failed to verify account profile" }, { status: 500 });
    }

    if (!profile) {
      profile = await ensureAccountProfile(getAdmin(), user);
      if (!profile) {
        return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
      }
    }

    // ── Parse request body ───────────────────────────────────
    const parsedBody = await parseAndValidateJsonRequest(request, uploadUrlRequestSchema, {
      invalidJsonMessage: "Invalid JSON body",
      validationErrorMessage: "Validation failed",
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const { filename, contentType, size, area } = parsedBody.data;

    // ── Validate ─────────────────────────────────────────────
    if (!VIDEO_TYPES.has(contentType)) {
      return NextResponse.json(
        {
          error: `Unsupported content type. Must be one of: ${[...VIDEO_TYPES].join(", ")}`,
        },
        { status: 400 }
      );
    }

    if (size > MAX_VIDEO_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum video size is 50 MB." },
        { status: 400 }
      );
    }

    // ── Generate key & presigned URL ─────────────────────────
    const bucket = process.env.R2_PUBLIC_BUCKET || "verifymzansi-public";
    const key = generateStorageKey(`media/${area}`, user.id, filename);

    const uploadUrl = await generatePresignedUploadUrl(
      bucket,
      key,
      contentType,
      3600, // 1 hour expiry
      size
    );

    const r2PublicUrl = process.env.R2_PUBLIC_URL;
    if (!r2PublicUrl) {
      log.error("R2_PUBLIC_URL env var is not configured", {
        traceId,
        userId: user.id,
        area,
      });
      return NextResponse.json(
        { error: "Upload service misconfigured", code: "upload_service_misconfigured", traceId },
        { status: 500, headers: { "x-upload-trace-id": traceId } }
      );
    }
    const publicUrl = `${r2PublicUrl}/${key}`;

    log.info("Generated presigned upload URL", {
      traceId,
      userId: user.id,
      area,
      contentType,
      size,
    });

    return NextResponse.json({
      uploadUrl,
      key,
      publicUrl,
    });
  } catch (err) {
    log.error("Failed to generate upload URL", {
      traceId,
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Failed to generate upload URL", code: "upload_url_generation_failed", traceId },
      { status: 500, headers: { "x-upload-trace-id": traceId } }
    );
  }
}
