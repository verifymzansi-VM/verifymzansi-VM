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
  try {
    // Auth check — admin/moderator only
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
    }

    const role = await verifyStaffActorRoleFromDb(user);
    if (!role) {
      return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    }

    const rl = checkLocalRateLimit(user.id, "admin:evidence:metadata");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests", code: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

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

    // Fetch step(s). Prefer explicit stepId, but fall back to userId when
    // stepId is stale and the caller supplied both values.
    let steps: Array<Record<string, unknown>> | null = null;
    let stepsErr: { message?: string } | null = null;

    if (stepId) {
      const stepLookup = await adminClient
        .from("verification_steps")
        .select(
          "id, user_id, step_type, status, risk_score, risk_level, auto_status, reviewed_by, reviewed_at, decided_at, rejection_reason, created_at, updated_at"
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
            "id, user_id, step_type, status, risk_score, risk_level, auto_status, reviewed_by, reviewed_at, decided_at, rejection_reason, created_at, updated_at"
          )
          .eq("user_id", userId);
        steps = userLookup.data as Array<Record<string, unknown>> | null;
        stepsErr = userLookup.error as { message?: string } | null;
      }
    } else {
      const userLookup = await adminClient
        .from("verification_steps")
        .select(
          "id, user_id, step_type, status, risk_score, risk_level, auto_status, reviewed_by, reviewed_at, decided_at, rejection_reason, created_at, updated_at"
        )
        .eq("user_id", userId as string);
      steps = userLookup.data as Array<Record<string, unknown>> | null;
      stepsErr = userLookup.error as { message?: string } | null;
    }

    if (stepsErr || !steps || steps.length === 0) {
      return NextResponse.json(
        { error: "Verification step(s) not found", code: "not_found" },
        { status: 404 }
      );
    }

    const targetUserId = String(steps[0].user_id);
    const REVIEWABLE_STATES = [
      "pending",
      "submitted",
      "pending_review",
      "pending_auto",
      "auto_approved",
      "auto_rejected",
    ];
    const hasActiveCase = steps.some((s) => REVIEWABLE_STATES.includes(String(s.status)));
    if (!hasActiveCase) {
      log.warn("Evidence metadata access denied: no active review case", {
        actorId: user.id,
        targetStepId: stepId,
        targetUserId: userId,
      });
      return NextResponse.json(
        { error: "No active verification case for this user", code: "no_active_case" },
        { status: 403 }
      );
    }

    const allowedArtifactIds = await getLinkedEvidenceArtifactIds(adminClient, targetUserId);

    if (allowedArtifactIds.length === 0) {
      return NextResponse.json(
        {
          error: "Evidence is not linked to the current verification session",
          code: "not_linked",
        },
        { status: 403 }
      );
    }

    // Fetch only artifacts linked to the current verification session.
    let artifacts: Array<Record<string, unknown>> = [];
    if (allowedArtifactIds.length > 0) {
      const { data } = await adminClient
        .from("kyc_artifacts")
        .select(
          "id, user_id, step_type, artifact_kind, r2_key, content_type, file_size_bytes, sha256, provider_ref, purge_after, status, created_at"
        )
        .in("id", allowedArtifactIds)
        .order("created_at", { ascending: false });
      artifacts = data || [];
    }

    // Fetch provider results for all artifacts
    const artifactIds = (artifacts || []).map((a) => a.id);
    let providerResults: unknown[] = [];
    if (artifactIds.length > 0) {
      const { data } = await adminClient
        .from("kyc_provider_results")
        .select(
          "id, artifact_id, provider_status, face_match_score, liveness_score, doc_auth_score, provider_ref, created_at"
        )
        .in("artifact_id", artifactIds);
      providerResults = data || [];
    }

    // Fetch risk signals
    const { data: riskSignals } = await adminClient
      .from("kyc_risk_signals")
      .select("id, user_id, artifact_id, signal_type, signal_key, score, detail, created_at")
      .eq("user_id", targetUserId)
      .order("created_at", { ascending: false });

    // Fetch account profile
    const { data: accountProfile } = await adminClient
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select(
        "display_name, account_verification_status, account_status, strikes, legal_hold, location_province, location_city"
      )
      .eq("user_id", targetUserId)
      .single();

    const accountProfilePayload = accountProfile
      ? {
          ...accountProfile,
          account_verification_status: readAccountVerificationStatus(accountProfile),
        }
      : null;

    // Fetch evidence access log (recent 20 entries)
    const { data: accessLog } = await adminClient
      .from("kyc_evidence_access_logs")
      .select("id, actor_id, actor_role, artifact_id, ip_hash, accessed_at")
      .eq("user_id", targetUserId)
      .order("accessed_at", { ascending: false })
      .limit(20);

    // Log this evidence view
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

    return NextResponse.json({
      steps,
      artifacts: artifacts || [],
      providerResults,
      riskSignals: riskSignals || [],
      accountProfile: accountProfilePayload,
      sellerProfile: accountProfilePayload,
      accessLog: accessLog || [],
    });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json(
      { error: "Internal server error", code: "server_error" },
      { status: 500 }
    );
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
