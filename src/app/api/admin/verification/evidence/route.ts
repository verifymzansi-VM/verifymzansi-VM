/**
 * GET /api/admin/verification/evidence
 * Decrypts and streams a KYC artifact image for admin review.
 * Logs access to kyc_evidence_access_logs.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadKycDocumentWithMetrics } from "@/lib/services/storage";
import { getLinkedEvidenceArtifactIds } from "@/lib/services/kyc-evidence-access";
import { createLogger } from "@/lib/utils/logger";
import { parseAndValidateSearchParams } from "@/lib/utils/api";
import { uuidSchema } from "@/lib/validations/shared";
import { z } from "zod";
import { authorizeEvidenceRequest } from "../_lib/evidence-route-auth";
import { forwardEvidencePostBodyToGet } from "../_lib/evidence-post-wrapper";
import { detectEvidenceContentType, hashIp } from "@/lib/services/evidence-serving";

const log = createLogger("EvidenceProxy");
const evidenceQuerySchema = z.object({
  artifactId: uuidSchema,
});
const evidenceBodySchema = z.object({
  artifactId: uuidSchema,
});

function isMissingArtifactError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // Match S3/R2 "not found" errors (NoSuchKey, 404, etc.)
  return (
    /not found|no such key|nosuchkey|404|code.*404/i.test(message) ||
    /does not exist|object not found|^404/i.test(message)
  );
}

export async function GET(request: NextRequest) {
  const requestStartedAt = Date.now();
  let authMs = 0;
  let dbMs = 0;
  let downloadMs = 0;
  let decryptMs = 0;
  let cacheHit = false;
  let responseStatus = 200;
  let targetUserId: string | null = null;

  try {
    const authStartedAt = Date.now();
    const auth = await authorizeEvidenceRequest({
      log,
      rateLimitAction: "admin:evidence:view",
    });
    if (!auth.success) {
      responseStatus = auth.status;
      return auth.response;
    }
    const { user, role } = auth;
    authMs = Date.now() - authStartedAt;

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

    const dbStartedAt = Date.now();
    // Fetch artifact record
    const { data: artifact, error: artifactErr } = await adminClient
      .from("kyc_artifacts")
      .select("id, user_id, r2_key, content_type, artifact_kind, step_type, status, purge_after")
      .eq("id", artifactId)
      .single();

    if (artifactErr || !artifact) {
      dbMs = Date.now() - dbStartedAt;
      responseStatus = 404;
      return NextResponse.json({ error: "Artifact not found", code: "not_found" }, { status: 404 });
    }
    targetUserId = artifact.user_id;
    if (artifact.purge_after) {
      const expiresAt = Date.parse(artifact.purge_after);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        responseStatus = 410;
        return NextResponse.json(
          { error: "Evidence access has expired", code: "expired_artifact" },
          { status: 410 }
        );
      }
    }

    const REVIEWABLE_STATES = [
      "pending",
      "submitted",
      "pending_review",
      "pending_auto",
      "auto_approved",
      "auto_rejected",
    ];
    const { count: activeStepCount, error: stepCountErr } = await adminClient
      .from("verification_steps")
      .select("id", { count: "exact", head: true })
      .eq("user_id", artifact.user_id)
      .in("status", REVIEWABLE_STATES);

    if (stepCountErr || !activeStepCount || activeStepCount === 0) {
      // A staff role does not authorize access to a closed or unreadable case.
      log.warn("Evidence accessed without an active review step", {
        actorId: user.id,
        targetUserId: artifact.user_id,
        artifactId,
        stepCountErr: stepCountErr?.message,
        activeStepCount,
      });
      responseStatus = stepCountErr ? 503 : 403;
      return NextResponse.json(
        {
          error: stepCountErr
            ? "Evidence authorization is unavailable"
            : "No active verification case for this user",
          code: stepCountErr ? "authorization_unavailable" : "no_active_case",
        },
        { status: responseStatus }
      );
    }

    const allowedArtifactIds = await getLinkedEvidenceArtifactIds(adminClient, artifact.user_id);

    if (!allowedArtifactIds.includes(artifact.id)) {
      // Only the session links and current candidates exposed by metadata may be viewed.
      log.warn("Evidence accessed outside the linked session list", {
        actorId: user.id,
        targetUserId: artifact.user_id,
        artifactId,
      });
      responseStatus = 403;
      return NextResponse.json(
        { error: "Artifact is not linked to this verification session", code: "unlinked_artifact" },
        { status: 403 }
      );
    }
    dbMs = Date.now() - dbStartedAt;

    // Validate IP hashing secret — required in production for privacy-compliant logging
    const ipHashSecret = process.env.IP_HASH_SECRET;
    if (!ipHashSecret && process.env.NODE_ENV === "production") {
      log.error("IP_HASH_SECRET not configured in production");
      responseStatus = 503;
      return NextResponse.json(
        { error: "Service configuration error", code: "server_error" },
        { status: 503 }
      );
    }

    // Log evidence access. cf-connecting-ip is set by Cloudflare and cannot be
    // supplied by the client, unlike x-forwarded-for.
    const ipHash = hashIp(
      request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("x-real-ip") ||
        "unknown",
      ipHashSecret
    );

    const { error: accessLogErr } = await adminClient.from("kyc_evidence_access_logs").insert({
      actor_id: user.id,
      actor_role: role,
      artifact_id: artifact.id,
      user_id: artifact.user_id,
      ip_hash: ipHash,
    });
    if (accessLogErr) {
      // Fail closed: identity documents are never shown without a record of
      // who viewed them.
      log.error("Failed to log evidence access; refusing to serve", {
        error: accessLogErr.message,
        actorId: user.id,
        artifactId: artifact.id,
      });
      responseStatus = 503;
      return NextResponse.json(
        { error: "Evidence access could not be recorded. Please try again.", code: "server_error" },
        { status: 503 }
      );
    }

    // Check for dev:// keys (development mode)
    if (artifact.r2_key.startsWith("dev://")) {
      cacheHit = true;
      // Return a placeholder in dev mode
      const devHeaders: Record<string, string> = {
        "Content-Type": "text/plain",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      };
      return new NextResponse(Buffer.from("Development mode \u2014 no real artifact stored"), {
        status: 200,
        headers: devHeaders,
      });
    }

    // Download and decrypt exactly the requested document. Never substitute
    // another artifact: the reviewer and the access log must refer to the same
    // file.
    let decryptedBuffer: Buffer | null = null;
    try {
      const result = await downloadKycDocumentWithMetrics(artifact.r2_key);
      decryptedBuffer = result.buffer;
      downloadMs += result.downloadMs;
      decryptMs += result.decryptMs;
    } catch (downloadErr) {
      const downloadMessage = downloadErr instanceof Error ? downloadErr.message : "unknown error";

      if (isMissingArtifactError(downloadErr)) {
        // Expected after the retention purge; otherwise a storage gap.
        log.warn("Requested KYC artifact is missing in storage", {
          artifactId: artifact.id,
          userId: artifact.user_id,
          stepType: artifact.step_type,
          artifactStatus: artifact.status || "unknown",
        });
        responseStatus = 404;
        return NextResponse.json(
          {
            error: "This document is no longer stored. Ask the member to resubmit if needed.",
            code: "missing_file",
          },
          { status: 404 }
        );
      }

      const isDecryptError = /decrypt|cipher|decipher|invalid auth/i.test(downloadMessage);
      log.error("Failed to download/decrypt artifact", {
        artifactId: artifact.id,
        r2Key: artifact.r2_key,
        error: downloadMessage,
        errorType: isDecryptError ? "decryption" : "download",
        stack: downloadErr instanceof Error ? downloadErr.stack : undefined,
      });
      responseStatus = 500;
      return NextResponse.json(
        {
          error: isDecryptError
            ? "Failed to decrypt artifact"
            : "Failed to retrieve artifact from storage",
          code: "server_error",
        },
        { status: 500 }
      );
    }

    if (!decryptedBuffer) {
      log.error("Artifact retrieval completed without a decrypted buffer", {
        artifactId: artifact.id,
        userId: artifact.user_id,
      });
      responseStatus = 500;
      return NextResponse.json(
        { error: "Failed to retrieve artifact", code: "server_error" },
        { status: 500 }
      );
    }

    // Serve the type the bytes actually are (images and PDF only), not the
    // stored label; anything else downloads instead of rendering.
    const contentType = detectEvidenceContentType(decryptedBuffer);

    const responseHeaders: Record<string, string> = {
      "Content-Type": contentType ?? "application/octet-stream",
      "Content-Disposition": contentType ? "inline" : "attachment",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
    };

    return new NextResponse(new Uint8Array(decryptedBuffer), {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err) {
    responseStatus = 500;
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json(
      { error: "Internal server error", code: "server_error" },
      { status: 500 }
    );
  } finally {
    log.info("Evidence request performance", {
      totalMs: Date.now() - requestStartedAt,
      authMs,
      dbMs,
      downloadMs,
      decryptMs,
      cacheHit,
      status: responseStatus,
      targetUserId,
    });
  }
}

/**
 * POST /api/admin/verification/evidence
 * Same as GET but reads artifactId from the JSON body instead of query params
 * to prevent sensitive IDs from leaking into server logs and browser history.
 */
export async function POST(request: NextRequest) {
  return forwardEvidencePostBodyToGet({
    request,
    schema: evidenceBodySchema,
    logger: log,
    invalidJsonMessage: "Invalid JSON body",
    validationErrorMessage: "artifactId is required in request body",
    toSearchParams: ({ artifactId }, searchParams) => {
      searchParams.set("artifactId", artifactId);
    },
    get: GET,
  });
}
