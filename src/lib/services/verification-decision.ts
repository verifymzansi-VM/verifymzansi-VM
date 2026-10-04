import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { createNotification } from "@/lib/notifications";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import {
  sendVerificationApprovedEmail,
  sendVerificationRejectedEmail,
  sendVerificationResubmissionEmail,
} from "@/lib/services/email";
import { summarizeVerification } from "@/lib/account/verification-summary";
import { getAuthAdminUserSummary } from "@/lib/supabase/auth-admin-user";
import { scheduleBackgroundTask } from "@/lib/utils/background-task";
import type { StaffRole } from "@/types/enums";

const log = createLogger("VerificationDecision");
export const ID_NUMBER_IN_USE_ERROR = "This ID number is already linked to another account.";

export type VerificationDecision = "approved" | "rejected" | "needs_resubmission";

export interface VerificationStepRow {
  id: string;
  user_id: string;
  step_type: string;
  status: string;
  risk_level?: string | null;
  risk_score?: number | null;
  id_number_hmac?: string | null;
  /** Version of the step that was reviewed (optimistic lock). */
  updated_at?: string | null;
  override_decision_id?: string | null;
}

export type ApplyVerificationResult =
  { ok: true } | { ok: false; status: number; error: string; code?: string };

/** High and critical risk approvals are overrides that need a second person. */
export function isHighRiskStep(step: Pick<VerificationStepRow, "risk_level">): boolean {
  return step.risk_level === "high" || step.risk_level === "critical";
}

/**
 * Apply a KYC step decision: the step, its latest artifact, the account's
 * verification status, audit, in-app notification and email. Used for
 * ordinary reviews and for approved high-risk overrides.
 *
 * `allowAlreadyApplied` lets a retried override continue when the step
 * update itself already succeeded on an earlier attempt.
 */
export async function applyVerificationDecision({
  step,
  decision,
  reasonCode = null,
  reasonNote = null,
  overrideReasonCode = null,
  reviewerId,
  reviewerRole,
  allowAlreadyApplied = false,
  overrideDecisionId,
  expectedSubmissionUpdatedAt,
}: {
  step: VerificationStepRow;
  decision: VerificationDecision;
  reasonCode?: string | null;
  reasonNote?: string | null;
  overrideReasonCode?: string | null;
  reviewerId: string;
  reviewerRole: StaffRole;
  allowAlreadyApplied?: boolean;
  overrideDecisionId?: string;
  expectedSubmissionUpdatedAt?: string;
}): Promise<ApplyVerificationResult> {
  const admin = createAdminClient();

  // A retry may finish downstream work only for the override that applied
  // this step. An unrelated approval is not evidence of prior execution.
  if (
    (allowAlreadyApplied || overrideDecisionId) &&
    (!overrideDecisionId || !expectedSubmissionUpdatedAt)
  ) {
    return {
      ok: false,
      status: 409,
      error: "The reviewed submission is unavailable",
      code: "step_changed",
    };
  }

  // Without the ID number hash the duplicate-identity check cannot run, so the
  // same person could verify several accounts.
  if (decision === "approved" && step.step_type === "id_doc" && !step.id_number_hmac) {
    return {
      ok: false,
      status: 409,
      error: "This ID submission has no ID number. Request a resubmission instead.",
      code: "id_number_missing",
    };
  }

  if (decision === "approved" && step.step_type === "id_doc" && step.id_number_hmac) {
    const { data: idConflict, error: idConflictError } = await admin
      .from("verification_steps")
      .select("id, user_id")
      .eq("step_type", "id_doc")
      .eq("status", "approved")
      .eq("id_number_hmac", step.id_number_hmac)
      .neq("user_id", step.user_id)
      .limit(1)
      .maybeSingle();

    if (idConflictError) {
      log.error("Failed to verify ID ownership conflict before approval", {
        stepId: step.id,
        error: idConflictError.message,
      });
      return { ok: false, status: 500, error: "Failed to validate ID ownership" };
    }

    if (idConflict) {
      return { ok: false, status: 409, error: ID_NUMBER_IN_USE_ERROR, code: "id_number_duplicate" };
    }
  }

  // Update the verification step
  const updateData: Record<string, unknown> = {
    status: decision,
    reviewed_by: reviewerId,
    reviewed_at: new Date().toISOString(),
  };
  if (overrideDecisionId || step.override_decision_id !== undefined) {
    updateData.override_decision_id = overrideDecisionId ?? null;
  }

  if (decision !== "approved") {
    updateData.reason_code = reasonCode;
    updateData.reason_note = reasonNote || null;
  } else {
    // Clear stale rejection metadata from any previous decision on this step
    updateData.reason_code = null;
    updateData.reason_note = null;
  }

  if (overrideReasonCode) {
    updateData.override_reason_code = overrideReasonCode;
  }

  // CAS guard: only update steps that are still in a reviewable state.
  // Prevents two admins from overwriting each other's decisions.
  let stepUpdate = admin
    .from("verification_steps")
    .update(updateData)
    .eq("id", step.id)
    .in("status", ["pending", "needs_resubmission"]);
  // Optimistic lock: a re-upload between reading and deciding bumps
  // updated_at, so the decision cannot land on evidence nobody reviewed.
  const expectedUpdatedAt = expectedSubmissionUpdatedAt ?? step.updated_at;
  if (expectedUpdatedAt) {
    stepUpdate = stepUpdate.eq("updated_at", expectedUpdatedAt);
  }
  const { data: updatedRows, error: updateError } = await stepUpdate.select("id");

  if (updateError) {
    const isApprovedIdConflict =
      updateError.code === "23505" &&
      (updateError.message?.includes("idx_verification_steps_unique_approved_id_hmac") ?? false);

    if (isApprovedIdConflict) {
      return { ok: false, status: 409, error: ID_NUMBER_IN_USE_ERROR, code: "id_number_duplicate" };
    }

    log.error("Failed to update verification step", {
      stepId: step.id,
      decision,
      error: updateError.message,
      code: updateError.code,
      details: updateError.details,
      hint: updateError.hint,
    });
    return { ok: false, status: 500, error: "Failed to update verification step" };
  }

  if (!updatedRows?.length) {
    // A retried override may find its own earlier update already applied;
    // carry on with the rest of the workflow, which is safe to repeat.
    let alreadyApplied =
      allowAlreadyApplied &&
      step.status === decision &&
      step.override_decision_id === overrideDecisionId &&
      typeof step.updated_at === "string";
    if (alreadyApplied) {
      // Re-read after the failed CAS: the caller's row could have changed
      // while the conditional update was in flight.
      const { data: appliedStep, error: appliedStepError } = await admin
        .from("verification_steps")
        .select("id")
        .eq("id", step.id)
        .eq("status", decision)
        .eq("override_decision_id", overrideDecisionId!)
        .eq("updated_at", step.updated_at!)
        .maybeSingle();
      alreadyApplied = !appliedStepError && Boolean(appliedStep);
    }
    if (!alreadyApplied) {
      return {
        ok: false,
        status: 409,
        error: "Step already reviewed or no longer in a reviewable state",
      };
    }
  }

  // Sync the latest artifact status to match the step decision.
  // NOTE: PostgREST ignores .order()/.limit() on UPDATE, so we SELECT
  // the latest artifact first, then update by its specific ID.
  const artifactStatus =
    decision === "approved"
      ? "approved"
      : decision === "needs_resubmission"
        ? "needs_resubmission"
        : "rejected";

  const { data: latestArtifact, error: artifactFetchErr } = await admin
    .from("kyc_artifacts")
    .select("id")
    .eq("user_id", step.user_id)
    .eq("step_type", step.step_type)
    .in("status", ["pending", "needs_resubmission"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (artifactFetchErr) {
    log.warn("Failed to fetch latest artifact for status sync (non-fatal)", {
      stepId: step.id,
      error: artifactFetchErr.message,
    });
  }

  if (latestArtifact) {
    const { error: artifactSyncError } = await admin
      .from("kyc_artifacts")
      .update({ status: artifactStatus })
      .eq("id", latestArtifact.id);

    if (artifactSyncError) {
      log.warn("Failed to sync artifact status (non-fatal)", {
        error: artifactSyncError.message,
        stepId: step.id,
        decision,
      });
    }
  }

  // If approved, check if all 4 steps are now approved → update the account to verified
  if (decision === "approved") {
    const { data: allSteps, error: allStepsErr } = await admin
      .from("verification_steps")
      .select("step_type, status, reviewed_at")
      .eq("user_id", step.user_id);

    if (allStepsErr) {
      log.warn("Failed to fetch all verification steps (non-fatal)", {
        userId: step.user_id,
        error: allStepsErr.message,
      });
    }

    const approvedSteps = (allSteps || []).filter((s) => s.status === "approved");
    // Location is self-service (auto-approved) so it will already be in the
    // approved set by the time admin reviews id_doc / selfie.
    const requiredSteps = ["phone", "id_doc", "selfie", "location"];
    const allApproved = requiredSteps.every((reqStep) =>
      approvedSteps.some((s) => s.step_type === reqStep)
    );
    const identityAdminReviewed = ["id_doc", "selfie"].every((identityStep) =>
      approvedSteps.some(
        (s) =>
          s.step_type === identityStep &&
          typeof s.reviewed_at === "string" &&
          s.reviewed_at.trim().length > 0
      )
    );

    if (allApproved && identityAdminReviewed) {
      // ── Propagate legal name from id_doc step → seller_profiles ──
      const idDocStep = (allSteps || []).find(
        (s) => s.step_type === "id_doc" && s.status === "approved"
      );

      const legalNamePatch: Record<string, unknown> = {
        account_verification_status: "verified",
      };

      if (idDocStep) {
        // Fetch first_name / last_name from the id_doc verification step
        const { data: idDocDetail } = await admin
          .from("verification_steps")
          .select("first_name, last_name")
          .eq("user_id", step.user_id)
          .eq("step_type", "id_doc")
          .maybeSingle();

        if (idDocDetail?.first_name && idDocDetail?.last_name) {
          const fullLegalName = `${idDocDetail.first_name} ${idDocDetail.last_name}`;
          legalNamePatch.legal_first_name = idDocDetail.first_name;
          legalNamePatch.legal_last_name = idDocDetail.last_name;
          legalNamePatch.display_name = fullLegalName;
          legalNamePatch.legal_name_locked_at = new Date().toISOString();

          log.info("Propagating legal name from verified ID to profile", {
            userId: step.user_id,
            legalNamePropagated: true,
          });
        }
      }

      const { error: profileErr } = await admin
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .update(legalNamePatch)
        .eq("user_id", step.user_id);
      if (profileErr) {
        log.error("Failed to update account profile after approval", {
          error: profileErr.message,
          userId: step.user_id,
        });
        return { ok: false, status: 500, error: "Failed to propagate verification status" };
      }

      // Set purge_after = NOW + 30 days on all KYC artifacts for this user
      const purgeAfter = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { error: purgeErr } = await admin
        .from("kyc_artifacts")
        .update({ purge_after: purgeAfter })
        .eq("user_id", step.user_id)
        .is("purge_after", null);

      if (purgeErr) {
        log.error("Failed to schedule KYC artifact purge", {
          userId: step.user_id,
          error: purgeErr.message,
        });
      } else {
        try {
          await logAuditEvent({
            actorId: reviewerId,
            actorRole: reviewerRole,
            action: "kyc_purge_scheduled",
            targetType: "account_profile",
            targetId: step.user_id,
            metadata: {
              purge_after: purgeAfter,
              step_count: approvedSteps.length,
              owner_user_id: step.user_id,
            },
          });
        } catch (auditErr) {
          log.error("Audit log failed (non-fatal)", {
            error: auditErr instanceof Error ? auditErr.message : "Unknown",
          });
        }
      }
    } else {
      const nextVerificationStatus = summarizeVerification(
        "incomplete",
        allSteps ?? []
      ).accountVerificationStatus;
      const { error: pendingErr } = await admin
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .update({
          account_verification_status: nextVerificationStatus,
        })
        .eq("user_id", step.user_id)
        .in("account_verification_status", ["incomplete", "pending_review", "rejected"]);
      if (pendingErr) {
        log.error("Failed to update account verification status after approval", {
          error: pendingErr.message,
          userId: step.user_id,
          nextVerificationStatus,
        });
      }
    }
  } else if (decision === "rejected") {
    // Include "verified" so that rejecting a step on a verified account
    // properly downgrades the account status (prevents verified + rejected step desync).
    const { error: rejectErr } = await admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .update({
        account_verification_status: "rejected",
      })
      .eq("user_id", step.user_id)
      .in("account_verification_status", ["incomplete", "pending_review", "rejected", "verified"]);
    if (rejectErr) {
      log.error("Failed to set account status to rejected", {
        error: rejectErr.message,
        userId: step.user_id,
      });
      return { ok: false, status: 500, error: "Failed to update account verification status" };
    }
  } else {
    // needs_resubmission should become incomplete/actionable so the user sees the fix path.
    // Include "verified" so re-review of a step on a verified account is handled.
    const { error: resubErr } = await admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .update({
        account_verification_status: "incomplete",
      })
      .eq("user_id", step.user_id)
      .in("account_verification_status", ["incomplete", "pending_review", "rejected", "verified"]);
    if (resubErr) {
      log.error("Failed to set account to incomplete for resubmission", {
        error: resubErr.message,
        userId: step.user_id,
      });
    }
  }

  // Log audit event (best-effort)
  const auditAction =
    decision === "approved"
      ? "verification_approved"
      : decision === "needs_resubmission"
        ? "verification_resubmission_requested"
        : "verification_rejected";

  try {
    await logAuditEvent({
      actorId: reviewerId,
      actorRole: reviewerRole,
      action: auditAction as
        "verification_approved" | "verification_rejected" | "verification_resubmission_requested",
      targetType: "verification_step",
      targetId: step.id,
      metadata: {
        step_type: step.step_type,
        decision,
        reasonCode,
        reasonNote,
        overrideReasonCode,
        risk_level: step.risk_level,
        risk_score: step.risk_score,
        owner_user_id: step.user_id,
      },
    });
  } catch (auditErr) {
    log.error("Audit log failed (non-fatal)", {
      error: auditErr instanceof Error ? auditErr.message : "Unknown",
    });
  }

  // Notify the account holder about the verification decision
  try {
    const stepLabel =
      step.step_type === "id_doc"
        ? "ID Document"
        : step.step_type === "selfie"
          ? "Selfie"
          : step.step_type === "location"
            ? "Location"
            : step.step_type === "phone"
              ? "Phone"
              : step.step_type;
    // Lowercase label for inline use — preserves "ID" casing
    const stepLabelInline = step.step_type === "id_doc" ? "ID document" : stepLabel.toLowerCase();

    if (decision === "approved") {
      await createNotification({
        userId: step.user_id,
        type: "success",
        title: `${stepLabel} verification approved`,
        message: `Your ${stepLabelInline} verification step has been approved.`,
        href: "/verification",
      });
    } else if (decision === "needs_resubmission") {
      await createNotification({
        userId: step.user_id,
        type: "warning",
        title: `${stepLabel} needs resubmission`,
        message: reasonNote
          ? `Please resubmit your ${stepLabelInline}: ${reasonNote.slice(0, 80)}`
          : `Please resubmit your ${stepLabelInline} verification.`,
        href: "/verification",
      });
    } else {
      await createNotification({
        userId: step.user_id,
        type: "error",
        title: `${stepLabel} verification rejected`,
        message: reasonNote
          ? reasonNote.slice(0, 100)
          : `Your ${stepLabelInline} verification was not accepted.`,
        href: "/verification",
      });
    }
  } catch (notifErr) {
    log.warn("Failed to send notification (non-fatal)", {
      error: notifErr instanceof Error ? notifErr.message : "Unknown",
    });
  }

  // Send transactional email for verification decisions (best-effort, non-blocking)
  try {
    const recipient = await getAuthAdminUserSummary(admin, step.user_id);
    const recipientEmail = recipient.email;
    if (recipientEmail) {
      const accountName = recipient.accountName;

      if (decision === "approved") {
        scheduleBackgroundTask(
          (async () => {
            const result = await sendVerificationApprovedEmail(recipientEmail, accountName);
            await logAuditEvent({
              actorId: reviewerId,
              actorRole: reviewerRole,
              action: result.success ? "communication_email_sent" : "communication_email_failed",
              targetType: "account_profile",
              targetId: step.user_id,
              metadata: {
                template: "verification_approved",
                channel: "email",
                error: result.error,
                owner_user_id: step.user_id,
              },
            });
          })(),
          "verification approved email"
        );
      } else if (decision === "needs_resubmission") {
        const reasonText = reasonNote || reasonCode || "Please review and resubmit your details.";
        scheduleBackgroundTask(
          (async () => {
            const result = await sendVerificationResubmissionEmail(
              recipientEmail,
              accountName,
              reasonText
            );
            await logAuditEvent({
              actorId: reviewerId,
              actorRole: reviewerRole,
              action: result.success ? "communication_email_sent" : "communication_email_failed",
              targetType: "account_profile",
              targetId: step.user_id,
              metadata: {
                template: "verification_resubmission",
                channel: "email",
                error: result.error,
                owner_user_id: step.user_id,
              },
            });
          })(),
          "verification resubmission email"
        );
      } else {
        const reasonText =
          reasonNote || reasonCode || "Your submission did not meet verification requirements.";
        scheduleBackgroundTask(
          (async () => {
            const result = await sendVerificationRejectedEmail(
              recipientEmail,
              accountName,
              reasonText
            );
            await logAuditEvent({
              actorId: reviewerId,
              actorRole: reviewerRole,
              action: result.success ? "communication_email_sent" : "communication_email_failed",
              targetType: "account_profile",
              targetId: step.user_id,
              metadata: {
                template: "verification_rejected",
                channel: "email",
                error: result.error,
                owner_user_id: step.user_id,
              },
            });
          })(),
          "verification rejected email"
        );
      }
    }
  } catch (emailLookupErr) {
    log.warn("Failed to resolve verification email recipient", {
      userId: step.user_id,
      error: emailLookupErr instanceof Error ? emailLookupErr.message : "Unknown",
    });
  }

  return { ok: true };
}
