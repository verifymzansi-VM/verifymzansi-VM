/**
 * GET /api/admin/verification/evidence/metadata
 * Returns all evidence metadata for a given step or user:
 * artifacts, provider results, risk signals, step details.
 */

import { type NextRequest, NextResponse } from "next/server";
import { ACCOUNT_PROFILE_WRITE_TABLE, readAccountVerificationStatus } from "@/lib/account/compat";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { getRoleFromUser, isModeratorOrAdmin } from "@/lib/auth/roles";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("EvidenceMetadata");

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

    const stepId = request.nextUrl.searchParams.get("stepId");
    const userId = request.nextUrl.searchParams.get("userId");

    if (!stepId && !userId) {
      return NextResponse.json(
        { error: "stepId or userId query parameter is required" },
        { status: 400 }
      );
    }

    // Validate UUID format to prevent data enumeration
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (stepId && !UUID_RE.test(stepId)) {
      return NextResponse.json({ error: "Invalid step ID format" }, { status: 400 });
    }
    if (userId && !UUID_RE.test(userId)) {
      return NextResponse.json({ error: "Invalid user ID format" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Fetch step(s)
    let stepsQuery = adminClient.from("verification_steps").select("*");

    if (stepId) {
      stepsQuery = stepsQuery.eq("id", stepId);
    } else if (userId) {
      stepsQuery = stepsQuery.eq("user_id", userId);
    }

    const { data: steps, error: stepsErr } = await stepsQuery;

    if (stepsErr || !steps || steps.length === 0) {
      return NextResponse.json({ error: "Verification step(s) not found" }, { status: 404 });
    }

    const targetUserId = steps[0].user_id;

    // Fetch all artifacts for this user
    const { data: artifacts } = await adminClient
      .from("kyc_artifacts")
      .select(
        "id, user_id, step_type, artifact_kind, r2_key, content_type, file_size_bytes, sha256, provider_ref, purge_after, status, created_at"
      )
      .eq("user_id", targetUserId)
      .order("created_at", { ascending: false });

    // Fetch provider results for all artifacts
    const artifactIds = (artifacts || []).map((a) => a.id);
    let providerResults: unknown[] = [];
    if (artifactIds.length > 0) {
      const { data } = await adminClient
        .from("kyc_provider_results")
        .select("*")
        .in("artifact_id", artifactIds);
      providerResults = data || [];
    }

    // Fetch risk signals
    const { data: riskSignals } = await adminClient
      .from("kyc_risk_signals")
      .select("*")
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
      actorRole: (["admin", "moderator"].includes(role) ? role : "admin") as "admin" | "moderator",
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
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "unknown error" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
