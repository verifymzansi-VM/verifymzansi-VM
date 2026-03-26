/**
 * GET /api/admin/verification/evidence
 * Decrypts and streams a KYC artifact image for admin review.
 * Logs access to kyc_evidence_access_logs.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadKycDocument } from "@/lib/services/storage";
import crypto from "crypto";
import { verifyStaffActorRoleFromDb } from "@/lib/auth/admin-access";
import { getLinkedEvidenceArtifactIds } from "@/lib/services/kyc-evidence-access";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { parseAndValidateJsonRequest, parseAndValidateSearchParams } from "@/lib/utils/api";
import { uuidSchema } from "@/lib/validations/shared";
import { z } from "zod";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";

const log = createLogger("EvidenceProxy");
const evidenceQuerySchema = z.object({
  artifactId: uuidSchema,
});
const evidenceBodySchema = z.object({
  artifactId: uuidSchema,
});

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

    const role = await verifyStaffActorRoleFromDb(user);
    if (!role) {
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
    const parsedQuery = parseAndValidateSearchParams(
      request.nextUrl.searchParams,
      evidenceQuerySchema,
      {
        validationErrorMessage: "artifactId query parameter is required",
        includeValidationDetails: false,
      }
    );
    if (!parsedQuery.success) {
      return parsedQuery.response;
    }
    const { artifactId } = parsedQuery.data;

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

    const REVIEWABLE_STATES = [
      "submitted",
      "pending_review",
      "pending_auto",
      "auto_approved",
      "auto_rejected",
    ];
    const { count: activeStepCount } = await adminClient
      .from("verification_steps")
      .select("id", { count: "exact", head: true })
      .eq("user_id", artifact.user_id)
      .in("status", REVIEWABLE_STATES);

    if (!activeStepCount || activeStepCount === 0) {
      log.warn("Evidence access denied: no active review case for user", {
        actorId: user.id,
        targetUserId: artifact.user_id,
        artifactId,
      });
      return NextResponse.json(
        { error: "No active verification case for this user" },
        { status: 403 }
      );
    }

    const allowedArtifactIds = await getLinkedEvidenceArtifactIds(adminClient, artifact.user_id);

    if (!allowedArtifactIds.includes(artifact.id)) {
      log.warn(
        "Evidence access denied: artifact is not linked to the current verification session",
        {
          actorId: user.id,
          targetUserId: artifact.user_id,
          artifactId,
        }
      );
      return NextResponse.json(
        { error: "Artifact is not linked to the current verification session" },
        { status: 403 }
      );
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

/**
 * POST /api/admin/verification/evidence
 * Same as GET but reads artifactId from the JSON body instead of query params
 * to prevent sensitive IDs from leaking into server logs and browser history.
 */
export async function POST(request: NextRequest) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) {
      return originBlock;
    }

    const parsedBody = await parseAndValidateJsonRequest(request, evidenceBodySchema, {
      invalidJsonMessage: "Invalid JSON body",
      validationErrorMessage: "artifactId is required in request body",
      includeValidationDetails: false,
    });
    if (!parsedBody.success) {
      return parsedBody.response;
    }
    const { artifactId } = parsedBody.data;

    // Rewrite into the query-string so the GET handler logic can be reused
    const url = new URL(request.url);
    url.searchParams.set("artifactId", artifactId);
    const syntheticRequest = new NextRequest(url, {
      method: "GET",
      headers: request.headers,
    });
    return GET(syntheticRequest);
  } catch (err) {
    log.error("POST wrapper error", {
      error: err instanceof Error ? err.message : "unknown error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
