import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import type { MarketplaceArea, PlanTier } from "@/types/enums";

const log = createLogger("PlanTier");

type EntitlementTierRow = {
  tier: string | null;
  expires_at: string | null;
};

const DEFAULT_TIER: PlanTier = "starter";

/**
 * Resolve the active plan tier for a user in a marketplace area.
 * Queries the `entitlements` table, filters expired rows, and returns
 * the highest-priority active tier (or `"starter"` as the default).
 */
export async function getActivePlanTierForArea(
  userId: string,
  area: MarketplaceArea
): Promise<PlanTier> {
  const now = Date.now();

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("entitlements")
      .select("tier, expires_at")
      .eq("user_id", userId)
      .eq("area", area)
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(20);

    if (error || !data?.length) {
      log.warn("No active entitlement found, falling back to default tier", {
        userId,
        area,
        error: error?.message,
        rowCount: data?.length ?? 0,
      });
      return DEFAULT_TIER;
    }

    const valid = (data as EntitlementTierRow[]).find((row) => {
      if (!row.tier) {
        return false;
      }
      if (!row.expires_at) {
        return true;
      }
      return new Date(row.expires_at).getTime() > now;
    });

    return (valid?.tier as PlanTier | undefined) ?? DEFAULT_TIER;
  } catch (err) {
    log.error("Failed to fetch plan tier, using default", {
      userId,
      area,
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return DEFAULT_TIER;
  }
}
