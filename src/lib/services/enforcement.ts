/**
 * Enforcement actions — suspend, ban, or warn accounts.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT_PROFILE_WRITE_TABLE, getOwnerColumn } from "@/lib/account/compat";
import { logAuditEvent, type AuditAction } from "./audit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("Enforcement");

/** The set of supported moderation actions. */
export type EnforcementAction = "warning" | "suspend" | "ban" | "unban";

interface EnforceParams {
  ownerId: string;
  action: EnforcementAction;
  reason: string;
  moderatorId: string;
  reportId?: string;
  /** Marketplace area for accurate moderation record tracking */
  area?: string;
  /** Number of days for suspension duration (default: 7). Only used for "suspend" action. */
  durationDays?: number;
}

/**
 * Apply an enforcement action to an account (warn, suspend, ban, or unban).
 * Updates the account status, creates a moderation record,
 * hides all content on ban, and logs an audit event.
 */
export async function enforceAction(params: EnforceParams) {
  const supabase = createAdminClient();

  const statusMap: Record<EnforcementAction, string> = {
    warning: "active",
    suspend: "suspended",
    ban: "banned",
    unban: "active",
  };

  // For unban, read the current status BEFORE updating so we know what to restore
  let previousStatus: string | undefined;
  if (params.action === "unban") {
    const { data: profile, error: profileErr } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("account_status")
      .eq("user_id", params.ownerId)
      .single();
    if (profileErr || !profile) {
      throw new Error(`Account profile not found for unban: ${params.ownerId}`);
    }
    previousStatus = profile.account_status;
  }

  // Update account status
  const updatePayload: Record<string, unknown> = {
    account_status: statusMap[params.action],
  };
  if (params.action === "suspend") {
    const days = params.durationDays ?? 7;
    const suspendUntil = new Date();
    suspendUntil.setDate(suspendUntil.getDate() + days);
    updatePayload.suspended_until = suspendUntil.toISOString();
  }
  if (params.action === "unban") {
    updatePayload.suspended_until = null;
  }
  const { error } = await supabase
    .from(ACCOUNT_PROFILE_WRITE_TABLE)
    .update(updatePayload)
    .eq("user_id", params.ownerId);

  if (error) {
    throw new Error("Failed to update account status");
  }

  // Create moderation action record
  const { error: insertErr } = await supabase.from("moderation_actions").insert({
    target_owner_id: params.ownerId,
    actor_id: params.moderatorId,
    action: params.action,
    reason: params.reason,
    report_id: params.reportId || null,
    area: params.area || "MZANSI_MARKET",
  });
  if (insertErr) {
    throw new Error(`Failed to record moderation action: ${insertErr.message}`);
  }

  // Resolve owner columns via compat layer — propagate transient errors
  // instead of silently falling back to a possibly-wrong column.
  let listingsOwnerCol: Awaited<ReturnType<typeof getOwnerColumn>>;
  let businessesOwnerCol: Awaited<ReturnType<typeof getOwnerColumn>>;
  let promotionsOwnerCol: Awaited<ReturnType<typeof getOwnerColumn>>;
  try {
    [listingsOwnerCol, businessesOwnerCol, promotionsOwnerCol] = await Promise.all([
      getOwnerColumn(supabase as never, "listings"),
      getOwnerColumn(supabase as never, "businesses"),
      getOwnerColumn(supabase as never, "promotions"),
    ]);
  } catch (colErr) {
    log.error("Failed to resolve owner columns for enforcement", {
      error: colErr instanceof Error ? colErr.message : String(colErr),
    });
    throw new Error(
      `Cannot enforce moderation: owner column probe failed (${colErr instanceof Error ? colErr.message : "unknown"})`
    );
  }

  // If banned, hide all content across all marketplace areas (including promotions)
  if (params.action === "ban") {
    const hideResults = await Promise.allSettled([
      supabase.from("listings").update({ status: "hidden" }).eq(listingsOwnerCol, params.ownerId),
      supabase
        .from("businesses")
        .update({ status: "hidden" })
        .eq(businessesOwnerCol, params.ownerId),
      supabase
        .from("promotions")
        .update({ status: "hidden" })
        .eq(promotionsOwnerCol, params.ownerId),
    ]);
    const hideErrors = hideResults
      .map((r) => (r.status === "rejected" ? r.reason : r.value?.error))
      .filter(Boolean);
    if (hideErrors.length > 0) {
      log.error("Failed to hide some content on ban", {
        errors: hideErrors.map((e) => (e instanceof Error ? e.message : String(e?.message ?? e))),
      });
    }
  }

  // If suspended, hide live content temporarily across all areas (including promotions)
  if (params.action === "suspend") {
    const suspendResults = await Promise.allSettled([
      supabase
        .from("listings")
        .update({ status: "hidden" })
        .eq(listingsOwnerCol, params.ownerId)
        .eq("status", "live"),
      supabase
        .from("businesses")
        .update({ status: "hidden" })
        .eq(businessesOwnerCol, params.ownerId)
        .eq("status", "live"),
      supabase
        .from("promotions")
        .update({ status: "hidden" })
        .eq(promotionsOwnerCol, params.ownerId)
        .eq("status", "live"),
    ]);
    const suspendErrors = suspendResults
      .map((r) => (r.status === "rejected" ? r.reason : r.value?.error))
      .filter(Boolean);
    if (suspendErrors.length > 0) {
      log.error("Failed to hide some content on suspend", {
        errors: suspendErrors.map((e) =>
          e instanceof Error ? e.message : String(e?.message ?? e)
        ),
      });
    }
  }

  // If unbanned/unsuspended, only reactivate content that was hidden by moderation.
  // We use the previousStatus (read BEFORE the update) to verify they were actually banned/suspended.
  // We only restore content that was hidden AFTER the most recent ban/suspend action
  // to avoid restoring content that was hidden by the account holder or by prior moderation.
  if (
    params.action === "unban" &&
    (previousStatus === "banned" || previousStatus === "suspended")
  ) {
    // Find the timestamp of the most recent ban/suspend action for this account
    const { data: lastAction } = await supabase
      .from("moderation_actions")
      .select("created_at")
      .eq("target_owner_id", params.ownerId)
      .in("action", ["ban", "suspend"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const hiddenSince = lastAction?.created_at || new Date(0).toISOString();

    // Only restore content that was updated (hidden) after the ban/suspend action
    const restoreResults = await Promise.allSettled([
      supabase
        .from("listings")
        .update({ status: "live" })
        .eq(listingsOwnerCol, params.ownerId)
        .eq("status", "hidden")
        .gte("updated_at", hiddenSince),
      supabase
        .from("businesses")
        .update({ status: "live" })
        .eq(businessesOwnerCol, params.ownerId)
        .eq("status", "hidden")
        .gte("updated_at", hiddenSince),
      supabase
        .from("promotions")
        .update({ status: "live" })
        .eq(promotionsOwnerCol, params.ownerId)
        .eq("status", "hidden")
        .gte("updated_at", hiddenSince),
    ]);
    const restoreErrors = restoreResults
      .map((r) => (r.status === "rejected" ? r.reason : r.value?.error))
      .filter(Boolean);
    if (restoreErrors.length > 0) {
      log.error("Failed to restore some content on unban", {
        errors: restoreErrors.map((e) =>
          e instanceof Error ? e.message : String(e?.message ?? e)
        ),
      });
    }
  }

  // Audit log
  const auditActionMap: Record<EnforcementAction, AuditAction> = {
    warning: "moderation_action",
    suspend: "account_suspended",
    ban: "account_banned",
    unban: "account_unbanned",
  };

  await logAuditEvent({
    actorId: params.moderatorId,
    actorRole: "moderator",
    action: auditActionMap[params.action],
    targetType: "account_profile",
    targetId: params.ownerId,
    metadata: { reason: params.reason, reportId: params.reportId },
  });

  // If report was linked, resolve it
  if (params.reportId) {
    const { error: reportError } = await supabase
      .from("reports")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", params.reportId);

    if (reportError) {
      log.warn("Failed to resolve linked report", {
        reportId: params.reportId,
        error: reportError.message,
      });
    }
  }
}
