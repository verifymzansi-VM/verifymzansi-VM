/**
 * Audit logging service.
 * Records critical actions for compliance and debugging.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeUserRole } from "@/lib/account/compat";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("Audit");

/** Union of all auditable event actions in the system. */
export type AuditAction =
  | "user_registered"
  | "user_login"
  | "verification_submitted"
  | "verification_approved"
  | "verification_rejected"
  | "verification_resubmission_requested"
  | "listing_created"
  | "listing_updated"
  | "listing_deleted"
  | "listing_boosted"
  | "listing_featured"
  | "listing_urgent"
  | "business_profile_updated"
  | "business_profile_deleted"
  | "business_boosted"
  | "business_post_created"
  | "storefront_updated"
  | "storefront_deleted"
  | "storefront_boosted"
  | "storefront_post_created"
  | "promotion_created"
  | "promotion_boosted"
  | "promotion_featured"
  | "report_created"
  | "report_resolved"
  | "payment_completed"
  | "payment_failed"
  | "checkout_initiated"
  | "subscription_activated"
  | "subscription_cancelled"
  | "account_suspended"
  | "account_banned"
  | "account_unbanned"
  | "dsar_requested"
  | "dsar_started"
  | "dsar_completed"
  | "dsar_rejected"
  | "consent_updated"
  | "moderation_action"
  | "kyc_evidence_viewed"
  | "kyc_evidence_reviewed"
  | "kyc_provider_webhook_received"
  | "kyc_override_approved"
  | "kyc_purge_scheduled"
  | "feature_flag_toggled"
  | "kyc_session_started"
  | "kyc_gps_submitted"
  | "kyc_proof_uploaded"
  | "kyc_manual_location_submitted";

interface AuditLogEntry {
  actorId: string;
  actorRole?: "member" | "moderator" | "admin" | "system" | "owner";
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  area?: "MZANSI_MARKET" | "MALL_SHOPS" | "BUSINESS_ADS" | "MZANSI_BUSINESS" | "PROMOTIONS_EVENTS";
  metadata?: Record<string, unknown>;
}

/** Counter for monitoring audit write failures (POPIA compliance). */
let auditFailureCount = 0;
const AUDIT_FAILURE_ALERT_THRESHOLD = 5;

/** Return the current count of audit write failures for monitoring. */
export function getAuditFailureCount(): number {
  return auditFailureCount;
}

/** Reset the failure counter (for testing and after manual investigation). */
export function resetAuditFailureCount(): void {
  auditFailureCount = 0;
}

/**
 * Insert an audit log entry into the `audit_logs` table.
 * Failures are logged structurally and counted for monitoring.
 * Audit logging never breaks the application, but failures are observable.
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    const supabase = createAdminClient();
    const actorRole =
      entry.actorRole === "system"
        ? "system"
        : (normalizeUserRole(entry.actorRole) ?? entry.actorRole ?? "system");

    const { error } = await supabase.from("audit_logs").insert({
      actor_id: entry.actorId,
      actor_role: actorRole,
      action: entry.action,
      target_type: entry.targetType || "unknown",
      target_id: entry.targetId || "00000000-0000-0000-0000-000000000000",
      area: entry.area || null,
      metadata: entry.metadata || {},
    });

    if (error) {
      auditFailureCount++;
      log.error("Audit log write failed (POPIA compliance risk)", {
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        dbError: error.message,
        failureCount: auditFailureCount,
      });
      if (auditFailureCount >= AUDIT_FAILURE_ALERT_THRESHOLD) {
        log.error(
          "CRITICAL: Audit failure threshold exceeded — POPIA compliance at risk. Investigate immediately.",
          {
            failureCount: auditFailureCount,
            threshold: AUDIT_FAILURE_ALERT_THRESHOLD,
          }
        );
      }
    }
  } catch (err) {
    auditFailureCount++;
    log.error("Audit log exception (POPIA compliance risk)", {
      action: entry.action,
      error: err instanceof Error ? err.message : "Unknown error",
      failureCount: auditFailureCount,
    });
    if (auditFailureCount >= AUDIT_FAILURE_ALERT_THRESHOLD) {
      log.error(
        "CRITICAL: Audit failure threshold exceeded — POPIA compliance at risk. Investigate immediately.",
        {
          failureCount: auditFailureCount,
          threshold: AUDIT_FAILURE_ALERT_THRESHOLD,
        }
      );
    }
  }
}
