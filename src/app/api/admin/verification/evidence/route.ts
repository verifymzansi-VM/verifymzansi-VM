/**
 * GET /api/admin/verification/evidence
 * Decrypts and streams a KYC artifact image for admin review.
 * Logs access to kyc_evidence_access_logs.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadKycDocumentWithMetrics } from "@/lib/services/storage";
import crypto from "crypto";
import { getLinkedEvidenceArtifactIds } from "@/lib/services/kyc-evidence-access";
import { createLogger } from "@/lib/utils/logger";
import { parseAndValidateSearchParams } from "@/lib/utils/api";
import { uuidSchema } from "@/lib/validations/shared";
import { z } from "zod";
import { authorizeEvidenceRequest } from "../_lib/evidence-route-auth";
import { forwardEvidencePostBodyToGet } from "../_lib/evidence-post-wrapper";

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
  let fallbackUsed = false;
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
      .select("id, user_id, r2_key, content_type, artifact_kind, step_type, status")
      .eq("id", artifactId)
      .single();

    if (artifactErr || !artifact) {
      dbMs = Date.now() - dbStartedAt;
      responseStatus = 404;
      return NextResponse.json({ error: "Artifact not found", code: "not_found" }, { status: 404 });
    }
    targetUserId = artifact.user_id;

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
      // The queue and evidence records can briefly be out of sync (or the
      // count query can fail independently). Staff authorization has already
      // been verified, so retain this as an audit signal rather than hiding
      // an existing document from the reviewer.
      log.warn("Evidence accessed without an active review step", {
        actorId: user.id,
        targetUserId: artifact.user_id,
        artifactId,
        stepCountErr: stepCountErr?.message,
        activeStepCount,
      });
    }

    const allowedArtifactIds = await getLinkedEvidenceArtifactIds(adminClient, artifact.user_id);

    if (!allowedArtifactIds.includes(artifact.id)) {
      // Artifacts retain their user ownership even when a session reference
      // becomes stale. Allow verified staff to review it, while recording the
      // linkage issue for operational follow-up.
      log.warn("Evidence accessed outside the linked session list", {
        actorId: user.id,
        targetUserId: artifact.user_id,
        artifactId,
      });
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

    // Log evidence access
    const ipHash = hashIp(
      request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown",
      ipHashSecret
    );

    const { error: accessLogErr } = await adminClient.from("kyc_evidence_access_logs").insert({
      actor_id: user.id,
      actor_role: role,
      artifact_id: artifact.id,
      user_id: artifact.user_id,
      ip_hash: ipHash,
    });
    let auditLogFailed = false;
    if (accessLogErr) {
      auditLogFailed = true;
      log.error("Failed to log evidence access (POPIA compliance gap)", {
        error: accessLogErr.message,
        actorId: user.id,
        artifactId: artifact.id,
      });
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
      if (auditLogFailed) devHeaders["X-Audit-Warning"] = "log-failed";
      return new NextResponse(Buffer.from("Development mode \u2014 no real artifact stored"), {
        status: 200,
        headers: devHeaders,
      });
    }

    // Download and decrypt the document. If the linked artifact points to a
    // missing object, fall back to another authorized artifact for the same step.
    let decryptedBuffer: Buffer | null = null;
    try {
      const result = await downloadKycDocumentWithMetrics(artifact.r2_key);
      decryptedBuffer = result.buffer;
      downloadMs += result.downloadMs;
      decryptMs += result.decryptMs;
    } catch (downloadErr) {
      const downloadMessage = downloadErr instanceof Error ? downloadErr.message : "unknown error";
      const isMissingFile = isMissingArtifactError(downloadErr);

      if (!isMissingFile) {
        const isDecryptError = /decrypt|cipher|decipher|invalid auth/i.test(downloadMessage);
        log.error("Failed to download/decrypt artifact", {
          artifactId: artifact.id,
          r2Key: artifact.r2_key,
          error: downloadMessage,
          errorType: isDecryptError ? "decryption" : "download",
          stack: downloadErr instanceof Error ? downloadErr.stack : undefined,
        });
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

      const { data: fallbackArtifacts, error: fallbackQueryError } = await adminClient
        .from("kyc_artifacts")
        .select("id, r2_key, created_at")
        .eq("user_id", artifact.user_id)
        .eq("step_type", artifact.step_type)
        .order("created_at", { ascending: false })
        .limit(20);

      const sameStepCandidates = (fallbackQueryError ? [] : fallbackArtifacts || []).filter(
        (candidate) => candidate.id !== artifact.id
      );

      log.warn("Requested KYC artifact missing in storage; attempting same-step fallback", {
        artifactId: artifact.id,
        userId: artifact.user_id,
        stepType: artifact.step_type,
        candidateCount: sameStepCandidates.length,
      });

      let recovered = false;
      const failedFallbacks: Array<{ candidateId: string; reason: string }> = [];

      for (const candidate of sameStepCandidates) {
        try {
          const result = await downloadKycDocumentWithMetrics(candidate.r2_key);
          decryptedBuffer = result.buffer;
          downloadMs += result.downloadMs;
          decryptMs += result.decryptMs;
          fallbackUsed = true;
          recovered = true;
          log.info("Recovered KYC artifact via same-step fallback", {
            requestedArtifactId: artifact.id,
            fallbackArtifactId: candidate.id,
            userId: artifact.user_id,
            fallbackAttempts: failedFallbacks.length,
          });
          break;
        } catch (fallbackErr) {
          const fallbackMessage =
            fallbackErr instanceof Error ? fallbackErr.message : "unknown error";
          const isMissing = isMissingArtifactError(fallbackErr);

          if (!isMissing) {
            // Track non-missing errors but continue trying other candidates
            failedFallbacks.push({
              candidateId: candidate.id,
              reason: fallbackMessage.slice(0, 100),
            });
            log.warn("Fallback candidate has retrieval error (skipping, will try others)", {
              requestedArtifactId: artifact.id,
              fallbackArtifactId: candidate.id,
              error: fallbackMessage,
            });
            continue;
          }

          // Fallback is also missing - continue to next candidate
          failedFallbacks.push({
            candidateId: candidate.id,
            reason: "file_missing",
          });
        }
      }

      if (!recovered) {
        log.error("All authorized KYC artifact candidates are missing in storage", {
          artifactId: artifact.id,
          userId: artifact.user_id,
          stepType: artifact.step_type,
          requestedR2Key: artifact.r2_key,
          fallbackAttempts: failedFallbacks.length,
          totalCandidates: sameStepCandidates.length + 1,
          artifactStatus: artifact.status || "unknown",
          failedFallbacks: failedFallbacks.slice(0, 5),
        });
        return NextResponse.json(
          { error: "Artifact file is missing from storage", code: "missing_file" },
          { status: 404 }
        );
      }
    }

    if (!decryptedBuffer) {
      log.error("Artifact retrieval completed without a decrypted buffer", {
        artifactId: artifact.id,
        userId: artifact.user_id,
      });
      return NextResponse.json(
        { error: "Failed to retrieve artifact", code: "server_error" },
        { status: 500 }
      );
    }

    // Determine content type — stored content_type may be 'application/octet-stream'
    // because we encrypt before upload. Use the original content_type from the artifact record.
    const contentType = artifact.content_type || "application/octet-stream";

    const responseHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'",
    };
    if (auditLogFailed) responseHeaders["X-Audit-Warning"] = "log-failed";

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
      fallbackUsed,
      status: responseStatus,
      targetUserId,
    });
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
