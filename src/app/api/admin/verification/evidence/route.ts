/**
 * GET /api/admin/verification/evidence
 * Decrypts and streams a KYC artifact image for admin review.
 * Logs access to kyc_evidence_access_logs.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadKycDocument } from "@/lib/services/storage";
import crypto from "crypto";
import { getRoleFromUser, isModeratorOrAdmin } from "@/lib/auth/roles";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";

const log = createLogger("EvidenceProxy");

export async function GET(request: NextRequest) {
  try {
    // Auth check — admin/moderator only
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = getRoleFromUser(user);
    if (!isModeratorOrAdmin(user) || !role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rl = checkLocalRateLimit(user.id, "admin:evidence:view");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    // Get artifact ID from query params
    const artifactId = request.nextUrl.searchParams.get("artifactId");
    if (!artifactId) {
      return NextResponse.json(
        { error: "artifactId query parameter is required" },
        { status: 400 }
      );
    }

    // Validate UUID format to prevent data enumeration
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(artifactId)) {
      return NextResponse.json({ error: "Invalid artifact ID format" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Fetch artifact record
    const { data: artifact, error: artifactErr } = await adminClient
      .from("kyc_artifacts")
      .select("id, user_id, r2_key, content_type, artifact_kind")
      .eq("id", artifactId)
      .single();

    if (artifactErr || !artifact) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    // Validate IP hashing secret — required in production for privacy-compliant logging
    const ipHashSecret = process.env.IP_HASH_SECRET;
    if (!ipHashSecret && process.env.NODE_ENV === "production") {
      log.error("IP_HASH_SECRET not configured in production");
      return NextResponse.json({ error: "Service configuration error" }, { status: 503 });
    }

    // Log evidence access
    const ipHash = hashIp(
      request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown",
      ipHashSecret
    );

    await adminClient.from("kyc_evidence_access_logs").insert({
      actor_id: user.id,
      actor_role: role,
      artifact_id: artifact.id,
      user_id: artifact.user_id,
      ip_hash: ipHash,
    });

    // Check for dev:// keys (development mode)
    if (artifact.r2_key.startsWith("dev://")) {
      // Return a placeholder in dev mode
      return new NextResponse(Buffer.from("Development mode — no real artifact stored"), {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
        },
      });
    }

    // Download and decrypt the document
    let decryptedBuffer: Buffer;
    try {
      decryptedBuffer = await downloadKycDocument(artifact.r2_key);
    } catch (downloadErr) {
      log.error("Failed to download/decrypt artifact", {
        error: downloadErr instanceof Error ? downloadErr.message : "unknown error",
      });
      return NextResponse.json({ error: "Failed to retrieve artifact" }, { status: 500 });
    }

    // Determine content type — stored content_type may be 'application/octet-stream'
    // because we encrypt before upload. Use the original content_type from the artifact record.
    const contentType = artifact.content_type || "application/octet-stream";

    return new NextResponse(new Uint8Array(decryptedBuffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": "inline",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'",
      },
    });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Hash an IP address for privacy-compliant logging.
 * Uses HMAC-SHA256 with a secret key to prevent rainbow-table deanonymisation.
 */
function hashIp(ip: string, secret: string | undefined): string {
  // In production, IP_HASH_SECRET is required (checked earlier in handler).
  // In dev, use a deterministic but non-production-safe fallback.
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("IP_HASH_SECRET is required in production");
  }
  const key = secret || "dev-only-local-not-for-production";
  return crypto.createHmac("sha256", key).update(ip).digest("hex").slice(0, 16);
}
