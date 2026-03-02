/**
 * POPIA consent record management.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "./audit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("Consent");

export type ConsentPurpose =
  | "marketing_email"
  | "marketing_sms"
  | "data_processing"
  | "third_party_sharing"
  | "analytics";

interface ConsentUpdate {
  userId: string;
  purpose: ConsentPurpose;
  granted: boolean;
}

/**
 * Upsert a POPIA consent record and log an audit event.
 * @param update - The user ID, purpose, and granted status.
 */
export async function updateConsent(
  update: ConsentUpdate
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createAdminClient();

    const { error } = await supabase.from("consent_records").upsert(
      {
        user_id: update.userId,
        purpose: update.purpose,
        granted: update.granted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,purpose" }
    );

    if (error) {
      log.error("Failed to upsert consent record", {
        error: error.message,
        userId: update.userId,
        purpose: update.purpose,
      });
      return { success: false, error: error.message };
    }

    await logAuditEvent({
      actorId: update.userId,
      action: "consent_updated",
      targetType: "consent",
      metadata: { purpose: update.purpose, granted: update.granted },
    });

    return { success: true };
  } catch (err) {
    log.error("Consent update exception", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return { success: false, error: "Failed to update consent" };
  }
}

/**
 * Retrieve all consent records for a user, falling back to safe defaults.
 * All purposes default to `false` (POPIA: explicit opt-in required).
 */
export async function getConsents(userId: string): Promise<Record<ConsentPurpose, boolean>> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("consent_records")
    .select("purpose, granted")
    .eq("user_id", userId);

  if (error) {
    log.error("Failed to fetch consent records", { error: error.message, userId });
  }

  const defaults: Record<ConsentPurpose, boolean> = {
    marketing_email: false,
    marketing_sms: false,
    data_processing: false,
    third_party_sharing: false,
    analytics: false,
  };

  if (data) {
    for (const record of data) {
      if (record.purpose in defaults) {
        defaults[record.purpose as ConsentPurpose] = record.granted;
      }
    }
  }

  return defaults;
}
