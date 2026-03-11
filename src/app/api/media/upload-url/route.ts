import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateStorageKey, generatePresignedUploadUrl } from "@/lib/services/storage";
import { createLogger } from "@/lib/utils/logger";
import { ACCOUNT_PROFILE_NOT_FOUND_ERROR } from "@/lib/account/compat";
import { UPLOAD_AREAS } from "@/types/enums";

const log = createLogger("MediaUploadUrl");

const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB

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
  try {
    // ── Authenticate ─────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    // ── Parse request body ───────────────────────────────────
    let body: {
      filename?: string;
      contentType?: string;
      size?: number;
      area?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { filename, contentType, size, area = "listing" } = body;

    if (!filename || !contentType || !size) {
      return NextResponse.json(
        { error: "Missing required fields: filename, contentType, size" },
        { status: 400 }
      );
    }

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

    if (!(UPLOAD_AREAS as readonly string[]).includes(area)) {
      return NextResponse.json(
        {
          error: `Invalid area. Must be one of: ${UPLOAD_AREAS.join(", ")}`,
        },
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
      3600 // 1 hour expiry
    );

    const publicUrl = process.env.R2_PUBLIC_URL
      ? `${process.env.R2_PUBLIC_URL}/${key}`
      : `https://media.verifymzansi.com/${key}`;

    log.info("Generated presigned upload URL", {
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
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}
