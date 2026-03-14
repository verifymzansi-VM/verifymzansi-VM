/**
 * POST /api/verification/session/start
 * Starts or resumes a verification session and returns step requirements.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { logAuditEvent } from "@/lib/services/audit";
import { REQUIRED_VERIFICATION_STEPS } from "@/lib/constants/verification";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("SessionStart");

export async function POST(_request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Feature flag check
    const v2Enabled = await isFeatureEnabled("kyc_v2_flow");
    if (!v2Enabled) {
      return NextResponse.json(
        { error: "New verification flow is not yet enabled" },
        { status: 404 }
      );
    }

    const adminClient = createAdminClient();

    // Fetch the most recent non-finalized verification session
    const { data: existingSession } = await adminClient
      .from("verification_sessions")
      .select("*")
      .eq("user_id", user.id)
      .is("finalized_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let session = existingSession;

    // If the existing session is expired, mark it and create a new one
    if (session) {
      const expiresAt = new Date(new Date(session.created_at).getTime() + 24 * 60 * 60 * 1000);
      if (expiresAt < new Date()) {
        // Mark expired session
        await adminClient
          .from("verification_sessions")
          .update({ finalized_at: new Date().toISOString() })
          .eq("id", session.id)
          .is("finalized_at", null);

        session = null; // Force creation of a new session below
      }
    }

    if (!session) {
      // Check if phone was already verified in a previous session or verification_steps
      const { data: phoneStep } = await adminClient
        .from("verification_steps")
        .select("phone_verified_at")
        .eq("user_id", user.id)
        .eq("step_type", "phone")
        .in("status", ["approved", "pending"])
        .maybeSingle();

      const { data: newSession, error: insertErr } = await adminClient
        .from("verification_sessions")
        .insert({
          user_id: user.id,
          ...(phoneStep?.phone_verified_at
            ? { phone_verified_at: phoneStep.phone_verified_at }
            : {}),
        })
        .select()
        .single();

      if (insertErr || !newSession) {
        log.error("Failed to create session", { error: insertErr?.message ?? "unknown" });
        return NextResponse.json(
          { error: "Failed to create verification session" },
          { status: 500 }
        );
      }

      session = newSession;

      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "kyc_session_started",
        targetType: "verification_session",
        targetId: session.id,
      });
    }

    // Fetch all existing verification steps for this user
    const { data: steps } = await adminClient
      .from("verification_steps")
      .select("step_type, status")
      .eq("user_id", user.id);

    const completedSteps: string[] = [];
    const pendingSteps: string[] = [];
    const rejectedSteps: string[] = [];

    for (const step of steps || []) {
      if (step.status === "approved") {
        completedSteps.push(step.step_type);
      } else if (step.status === "pending") {
        pendingSteps.push(step.step_type);
      } else if (step.status === "rejected" || step.status === "needs_resubmission") {
        rejectedSteps.push(step.step_type);
      }
    }

    // Calculate session expiry (24h from start)
    const expiresAt = new Date(
      new Date(session.created_at).getTime() + 24 * 60 * 60 * 1000
    ).toISOString();

    return NextResponse.json({
      sessionId: session.id,
      completedSteps,
      pendingSteps,
      rejectedSteps,
      requiredSteps: [...REQUIRED_VERIFICATION_STEPS],
      expiresAt,
      phoneVerifiedAt: session.phone_verified_at,
      idArtifactId: session.id_artifact_id,
      selfieArtifactId: session.selfie_artifact_id,
      locationSubmittedAt: session.location_submitted_at,
      finalizedAt: session.finalized_at,
    });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "unknown error" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
