/**
 * GET /api/admin/verification/evidence/metadata
 * Returns all evidence metadata for a given step or user:
 * artifacts, provider results, risk signals, step details.
 */

import { NextRequest, NextResponse } from "next/server";
import { ACCOUNT_PROFILE_WRITE_TABLE, readAccountVerificationStatus } from "@/lib/account/compat";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { verifyStaffActorRoleFromDb } from "@/lib/auth/admin-access";
import { getLinkedEvidenceArtifactIds } from "@/lib/services/kyc-evidence-access";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { parseAndValidateJsonRequest, parseAndValidateSearchParams } from "@/lib/utils/api";
import { optionalUuidSchema } from "@/lib/validations/shared";
import { z } from "zod";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";

const log = createLogger("EvidenceMetadata");
const evidenceMetadataQuerySchema = z
  .object({
    stepId: optionalUuidSchema,
    userId: optionalUuidSchema,
  })
  .refine(({ stepId, userId }) => Boolean(stepId || userId), {
    message: "stepId or userId query parameter is required",
  });

const evidenceMetadataBodySchema = z
  .object({
    stepId: optionalUuidSchema,
    userId: optionalUuidSchema,
  })
  .refine(({ stepId, userId }) => Boolean(stepId || userId), {
    message: "stepId or userId is required in request body",
  });

export async function GET(request: NextRequest) {
  const requestStartedAt = Date.now();
  let authMs = 0;
  let stepLookupMs = 0;
  let linkedArtifactLookupMs = 0;
  let artifactQueryMs = 0;
  let providerQueryMs = 0;
  let relatedQueryMs = 0;
  let auditMs = 0;
  let responseStatus = 200;
  let resolvedUserId: string | null = null;

  try {
    const authStartedAt = Date.now();
    // Auth check — admin/moderator only
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      responseStatus = 401;
      return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
    }

    const role = await verifyStaffActorRoleFromDb(user);
    if (!role) {
      responseStatus = 403;
      return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    }

    const rl = checkLocalRateLimit(user.id, "admin:evidence:metadata");
    if (rl.limited) {
      responseStatus = 429;
      return NextResponse.json(
        { error: "Too many requests", code: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }
    authMs = Date.now() - authStartedAt;

    const parsedQuery = parseAndValidateSearchParams(
      request.nextUrl.searchParams,
      evidenceMetadataQuerySchema,
      {
        validationErrorMessage: "Invalid evidence metadata query",
      }
    );
    if (!parsedQuery.success) {
      return parsedQuery.response;
    }
    const { stepId, userId } = parsedQuery.data;

    const adminClient = createAdminClient();

    const stepLookupStartedAt = Date.now();

    // Fetch step(s). Prefer explicit stepId, but fall back to userId when
    // stepId is stale and the caller supplied both values.
    let steps: Array<Record<string, unknown>> | null = null;
    let stepsErr: { message?: string } | null = null;

    if (stepId) {
      const stepLookup = await adminClient
        .from("verification_steps")
        .select(
          "id, user_id, step_type, status, risk_score, risk_level, auto_status, reviewed_by, reviewed_at, decided_at:reviewed_at, rejection_reason:reason_note, created_at, updated_at, first_name, last_name"
        )
        .eq("id", stepId);
      steps = stepLookup.data as Array<Record<string, unknown>> | null;
      stepsErr = stepLookup.error as { message?: string } | null;

      if ((!steps || steps.length === 0) && userId) {
        log.warn("Evidence metadata stepId not found; falling back to userId", {
          actorId: user.id,
          targetStepId: stepId,
          targetUserId: userId,
        });

        const userLookup = await adminClient
          .from("verification_steps")
          .select(
            "id, user_id, step_type, status, risk_score, risk_level, auto_status, reviewed_by, reviewed_at, decided_at:reviewed_at, rejection_reason:reason_note, created_at, updated_at, first_name, last_name"
          )
          .eq("user_id", userId);
        steps = userLookup.data as Array<Record<string, unknown>> | null;
        stepsErr = userLookup.error as { message?: string } | null;
      }
    } else {
      const userLookup = await adminClient
        .from("verification_steps")
        .select(
          "id, user_id, step_type, status, risk_score, risk_level, auto_status, reviewed_by, reviewed_at, decided_at:reviewed_at, rejection_reason:reason_note, created_at, updated_at, first_name, last_name"
        )
        .eq("user_id", userId as string);
      steps = userLookup.data as Array<Record<string, unknown>> | null;
      stepsErr = userLookup.error as { message?: string } | null;
    }

    if (stepsErr) {
      if (userId) {
        log.warn("Evidence metadata step lookup failed; using userId fallback", {
          actorId: user.id,
          targetStepId: stepId,
          targetUserId: userId,
          error: stepsErr.message,
        });
        steps = [];
      } else {
        stepLookupMs = Date.now() - stepLookupStartedAt;
        responseStatus = 404;
        return NextResponse.json(
          { error: "Verification step(s) not found", code: "not_found" },
          { status: 404 }
        );
      }
    }

    let targetUserId: string | null = null;
    if (steps && steps.length > 0) {
      targetUserId = String(steps[0].user_id);
    } else if (userId) {
      // Resilience path: if queue references drift but userId is known,
      // continue with artifact-based metadata instead of hard-failing.
      targetUserId = userId;
      steps = [];
      log.warn("Evidence metadata loaded without verification_steps rows", {
        actorId: user.id,
        targetStepId: stepId,
        targetUserId: userId,
      });
    } else {
      stepLookupMs = Date.now() - stepLookupStartedAt;
      responseStatus = 404;
      return NextResponse.json(
        { error: "Verification step(s) not found", code: "not_found" },
        { status: 404 }
      );
    }
    stepLookupMs = Date.now() - stepLookupStartedAt;
    resolvedUserId = targetUserId;
    const REVIEWABLE_STATES = [
      "pending",
      "submitted",
      "pending_review",
      "pending_auto",
      "auto_approved",
      "auto_rejected",
    ];
    const hasActiveCase = steps.some((s) => REVIEWABLE_STATES.includes(String(s.status)));
    if (steps.length > 0 && !hasActiveCase) {
      log.warn("Evidence metadata access denied: no active review case", {
        actorId: user.id,
        targetStepId: stepId,
        targetUserId: userId,
      });
      responseStatus = 403;
      return NextResponse.json(
        { error: "No active verification case for this user", code: "no_active_case" },
        { status: 403 }
      );
    }

    const linkedArtifactLookupStartedAt = Date.now();
    let allowedArtifactIds = await getLinkedEvidenceArtifactIds(adminClient, targetUserId);

    if (allowedArtifactIds.length === 0) {
      // Additional resilience fallback for legacy/drifted sessions:
      // use latest artifacts for this user when linked IDs are unavailable.
      const { data: fallbackArtifacts } = await adminClient
        .from("kyc_artifacts")
        .select("id")
        .eq("user_id", targetUserId)
        .order("created_at", { ascending: false })
        .limit(20);

      allowedArtifactIds = (fallbackArtifacts || [])
        .map((artifact) => String(artifact.id))
        .filter(Boolean);
    }
    linkedArtifactLookupMs = Date.now() - linkedArtifactLookupStartedAt;

    if (allowedArtifactIds.length === 0) {
      log.warn("Evidence metadata has no linked artifacts; returning empty artifact list", {
        actorId: user.id,
        targetStepId: stepId,
        targetUserId: targetUserId,
      });
    }

    // Fetch artifacts and related data. Queries that only depend on targetUserId
    // are parallelized to reduce overall latency.
    const artifactQueryStartedAt = Date.now();
    const artifactsPromise =
      allowedArtifactIds.length > 0
        ? adminClient
            .from("kyc_artifacts")
            .select(
              "id, user_id, step_type, artifact_kind, r2_key, content_type, file_size_bytes, sha256, provider_ref, purge_after, status, created_at"
            )
            .in("id", allowedArtifactIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null });

    const relatedQueryStartedAt = Date.now();
    const [riskSignalsResult, accountProfileResult, accessLogResult] = await Promise.all([
      adminClient
        .from("kyc_risk_signals")
        .select("id, user_id, artifact_id, signal_type, signal_key, score, detail, created_at")
        .eq("user_id", targetUserId)
        .order("created_at", { ascending: false }),
      adminClient
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .select(
          "display_name, account_verification_status, account_status, strikes, legal_hold, location_province, location_city"
        )
        .eq("user_id", targetUserId)
        .single(),
      adminClient
        .from("kyc_evidence_access_logs")
        .select("id, actor_id, actor_role, artifact_id, ip_hash, accessed_at")
        .eq("user_id", targetUserId)
        .order("accessed_at", { ascending: false })
        .limit(20),
    ]);
    relatedQueryMs = Date.now() - relatedQueryStartedAt;

    const artifactsResult = await artifactsPromise;
    artifactQueryMs = Date.now() - artifactQueryStartedAt;
    const artifacts = (artifactsResult.data || []) as Array<Record<string, unknown>>;

    // Fetch provider results for all artifacts
    const artifactIds = artifacts.map((a) => a.id);
    let providerResults: unknown[] = [];
    if (artifactIds.length > 0) {
      const providerStartedAt = Date.now();
      const { data, error: providerErr } = await adminClient
        .from("kyc_provider_results")
        .select(
          "id, artifact_id, provider_status, face_match_score, liveness_score, doc_auth_score, provider_ref, created_at"
        )
        .in("artifact_id", artifactIds);
      providerResults = data || [];
      providerQueryMs = Date.now() - providerStartedAt;

      if (providerErr) {
        log.warn("Provider result query failed during evidence metadata fetch", {
          actorId: user.id,
          targetUserId,
          error: providerErr.message,
        });
      }
    }

    if (artifactsResult.error) {
      log.warn("Artifact query failed during evidence metadata fetch", {
        actorId: user.id,
        targetUserId,
        error: artifactsResult.error.message,
      });
    }

    const riskSignals = riskSignalsResult.data || [];
    const accountProfile = accountProfileResult.data || null;
    const accessLog = accessLogResult.data || [];

    // Filter out risk signals linked to superseded (rejected) artifacts so admins
    // see a consolidated view per user instead of duplicate rows from resubmissions.
    const rejectedArtifactIds = new Set(
      (artifacts || []).filter((a) => a.status === "rejected").map((a) => a.id as string)
    );
    const activeRiskSignals = riskSignals.filter(
      (rs) => !rs.artifact_id || !rejectedArtifactIds.has(rs.artifact_id as string)
    );

    if (riskSignalsResult.error) {
      log.warn("Risk signal query failed during evidence metadata fetch", {
        actorId: user.id,
        targetUserId,
        error: riskSignalsResult.error.message,
      });
    }

    if (accountProfileResult.error) {
      log.warn("Account profile query failed during evidence metadata fetch", {
        actorId: user.id,
        targetUserId,
        error: accountProfileResult.error.message,
      });
    }

    if (accessLogResult.error) {
      log.warn("Evidence access-log query failed during evidence metadata fetch", {
        actorId: user.id,
        targetUserId,
        error: accessLogResult.error.message,
      });
    }

    const accountProfilePayload = accountProfile
      ? {
          ...accountProfile,
          account_verification_status: readAccountVerificationStatus(accountProfile),
        }
      : null;

    // Log this evidence view
    const auditStartedAt = Date.now();
    await logAuditEvent({
      actorId: user.id,
      actorRole: role,
      action: "kyc_evidence_viewed",
      targetType: "verification_step",
      targetId: stepId || targetUserId,
      metadata: {
        viewed_user_id: targetUserId,
        step_count: steps.length,
        artifact_count: (artifacts || []).length,
      },
    });
    auditMs = Date.now() - auditStartedAt;

    const totalMs = Date.now() - requestStartedAt;
    if (totalMs > 1000) {
      log.warn("Evidence metadata request slow", {
        totalMs,
        authMs,
        stepLookupMs,
        linkedArtifactLookupMs,
        artifactQueryMs,
        providerQueryMs,
        relatedQueryMs,
        auditMs,
        targetUserId,
        stepId,
      });
    } else {
      log.info("Evidence metadata request performance", {
        totalMs,
        authMs,
        stepLookupMs,
        linkedArtifactLookupMs,
        artifactQueryMs,
        providerQueryMs,
        relatedQueryMs,
        auditMs,
        targetUserId,
        stepId,
      });
    }

    return NextResponse.json({
      steps,
      artifacts: artifacts || [],
      providerResults,
      riskSignals: activeRiskSignals || [],
      accountProfile: accountProfilePayload,
      sellerProfile: accountProfilePayload,
      accessLog: accessLog || [],
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
    log.info("Evidence metadata request summary", {
      status: responseStatus,
      totalMs: Date.now() - requestStartedAt,
      authMs,
      stepLookupMs,
      linkedArtifactLookupMs,
      artifactQueryMs,
      providerQueryMs,
      relatedQueryMs,
      auditMs,
      targetUserId: resolvedUserId,
    });
  }
}

/**
 * POST /api/admin/verification/evidence/metadata
 * Same as GET but reads stepId/userId from the JSON body instead of query params
 * to prevent sensitive IDs from leaking into server logs and browser history.
 */
export async function POST(request: NextRequest) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) {
      return originBlock;
    }
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) {
      return csrfBlock;
    }

    const parsedBody = await parseAndValidateJsonRequest(request, evidenceMetadataBodySchema, {
      invalidJsonMessage: "Invalid JSON body",
      validationErrorMessage: "Invalid evidence metadata body",
    });
    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const { stepId, userId } = parsedBody.data;

    // Rewrite into the query-string so the GET handler logic can be reused
    const url = new URL(request.url);
    if (stepId) url.searchParams.set("stepId", stepId);
    if (userId) url.searchParams.set("userId", userId);
    const syntheticRequest = new NextRequest(url, {
      method: "GET",
      headers: request.headers,
    });
    return GET(syntheticRequest);
  } catch (err) {
    log.error("POST wrapper error", {
      error: err instanceof Error ? err.message : "unknown error",
    });
    return NextResponse.json(
      { error: "Internal server error", code: "server_error" },
      { status: 500 }
    );
  }
}
