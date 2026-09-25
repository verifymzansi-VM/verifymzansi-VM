import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { parseAcquisitionCookie } from "@/lib/analytics/acquisition";

const log = createLogger("Acquisition");

/**
 * Persist the first-touch acquisition source for a new account. Idempotent:
 * the database keeps the first record and never lets a later organisation
 * affiliation overwrite a partner attribution. Never blocks sign-up.
 */
export async function recordAcquisitionFromCookie(
  userId: string,
  cookieValue: string | undefined | null
): Promise<void> {
  try {
    const touch = parseAcquisitionCookie(cookieValue) ?? {};
    await createAdminClient().rpc("record_account_acquisition", {
      p_user: userId,
      p_values: { ...touch, source: touch.source ?? "DIRECT" },
    });
  } catch (error) {
    log.warn("Acquisition source not recorded", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
