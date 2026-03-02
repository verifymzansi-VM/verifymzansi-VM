/**
 * Enforcement actions — suspend, ban, warn sellers.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, type AuditAction } from "./audit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("Enforcement");

/** The set of supported moderation actions. */
export type EnforcementAction = "warning" | "suspend" | "ban" | "unban";

interface EnforceParams {
  sellerId: string;
  action: EnforcementAction;
  reason: string;
  moderatorId: string;
  reportId?: string;
  /** Marketplace area for accurate moderation record tracking */
  area?: string;
}

/**
 * Apply an enforcement action to a seller (warn, suspend, ban, or unban).
 * Updates the seller's account status, creates a moderation record,
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
      .from("seller_profiles")
      .select("account_status")
      .eq("user_id", params.sellerId)
      .single();
    if (profileErr || !profile) {
      throw new Error(`Seller profile not found for unban: ${params.sellerId}`);
    }
    previousStatus = profile.account_status;
  }

  // Update seller account status
  const { error } = await supabase
    .from("seller_profiles")
    .update({ account_status: statusMap[params.action] })
    .eq("user_id", params.sellerId);

  if (error) {
    throw new Error("Failed to update account status");
  }

  // Create moderation action record
  try {
    await supabase.from("moderation_actions").insert({
      target_seller_id: params.sellerId,
      actor_id: params.moderatorId,
      action: params.action,
      reason: params.reason,
      report_id: params.reportId || null,
      area: params.area || "MZANSI_MARKET",
    });
  } catch (insertErr) {
    throw new Error(
      `Failed to record moderation action: ${insertErr instanceof Error ? insertErr.message : "Unknown error"}`
    );
  }

  // If banned, hide all content across all marketplace areas
  if (params.action === "ban") {
    const hideResults = await Promise.all([
      supabase.from("listings").update({ status: "hidden" }).eq("seller_id", params.sellerId),
      supabase.from("storefronts").update({ status: "hidden" }).eq("seller_id", params.sellerId),
      supabase
        .from("business_profiles")
        .update({ status: "hidden" })
        .eq("seller_id", params.sellerId),
    ]);
    const hideErrors = hideResults.filter((r) => r.error);
    if (hideErrors.length > 0) {
      log.error("Failed to hide some content on ban", {
        errors: hideErrors.map((r) => r.error?.message),
      });
    }
  }

  // If suspended, hide live content temporarily across all areas
  if (params.action === "suspend") {
    const suspendResults = await Promise.all([
      supabase
        .from("listings")
        .update({ status: "hidden" })
        .eq("seller_id", params.sellerId)
        .eq("status", "live"),
      supabase
        .from("storefronts")
        .update({ status: "hidden" })
        .eq("seller_id", params.sellerId)
        .eq("status", "live"),
      supabase
        .from("business_profiles")
        .update({ status: "hidden" })
        .eq("seller_id", params.sellerId)
        .eq("status", "live"),
    ]);
    const suspendErrors = suspendResults.filter((r) => r.error);
    if (suspendErrors.length > 0) {
      log.error("Failed to hide some content on suspend", {
        errors: suspendErrors.map((r) => r.error?.message),
      });
    }
  }

  // If unbanned/unsuspended, only reactivate content that was hidden by moderation.
  // We use the previousStatus (read BEFORE the update) to verify they were actually banned/suspended.
  // We only restore content that was hidden AFTER the most recent ban/suspend action
  // to avoid restoring content that was hidden by the seller or by prior moderation.
  if (
    params.action === "unban" &&
    (previousStatus === "banned" || previousStatus === "suspended")
  ) {
    // Find the timestamp of the most recent ban/suspend action for this seller
    const { data: lastAction } = await supabase
      .from("moderation_actions")
      .select("created_at")
      .eq("target_seller_id", params.sellerId)
      .in("action", ["ban", "suspend"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const hiddenSince = lastAction?.created_at || new Date(0).toISOString();

    // Only restore content that was updated (hidden) after the ban/suspend action
    const restoreResults = await Promise.all([
      supabase
        .from("listings")
        .update({ status: "live" })
        .eq("seller_id", params.sellerId)
        .eq("status", "hidden")
        .gte("updated_at", hiddenSince),
      supabase
        .from("storefronts")
        .update({ status: "live" })
        .eq("seller_id", params.sellerId)
        .eq("status", "hidden")
        .gte("updated_at", hiddenSince),
      supabase
        .from("business_profiles")
        .update({ status: "live" })
        .eq("seller_id", params.sellerId)
        .eq("status", "hidden")
        .gte("updated_at", hiddenSince),
    ]);
    const restoreErrors = restoreResults.filter((r) => r.error);
    if (restoreErrors.length > 0) {
      log.error("Failed to restore some content on unban", {
        errors: restoreErrors.map((r) => r.error?.message),
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
    targetType: "seller_profile",
    targetId: params.sellerId,
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
