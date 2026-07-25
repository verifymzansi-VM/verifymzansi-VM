import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import type { MarketplaceArea, PlanTier } from "@/types/enums";

const log = createLogger("PlanTier");
const emittedFallbackWarnings = new Set<string>();

type EntitlementTierRow = {
  tier: string | null;
  expires_at: string | null;
};

const DEFAULT_TIER: PlanTier = "starter";

function isE2eLoggingContext(): boolean {
  const runtimeMode = (process.env.VERIFYMZANSI_RUNTIME_MODE || "").toLowerCase();
  return (
    runtimeMode === "e2e" ||
    runtimeMode === "playwright" ||
    runtimeMode === "test" ||
    process.env.PLAYWRIGHT_E2E_AUTH === "1"
  );
}

/**
 * Resolve the active plan tier for a user in a marketplace area.
 * Queries the `entitlements` table, filters expired rows, and returns
 * the highest-priority active tier (or `"starter"` as the default).
 *
 * Kept aligned with the posting gate in
 * `src/app/api/_lib/posting-entitlements.ts`: only `status = 'active'`
 * entitlements with a future `expires_at` count.
 */
export async function getActivePlanTierForArea(
  userId: string,
  area: MarketplaceArea
): Promise<PlanTier> {
  const now = Date.now();

  try {
    const supabase = createAdminClient();
    const nowIso = new Date(now).toISOString();
    const { data, error } = await supabase
      .from("entitlements")
      .select("tier, expires_at")
      .eq("user_id", userId)
      .eq("area", area)
      .eq("status", "active")
      .gt("expires_at", nowIso)
      .order("started_at", { ascending: false })
      .limit(20);

    if (error || !data?.length) {
      const warningSignature = `${userId}:${area}:${error?.message ?? "no-error"}:${data?.length ?? 0}`;
      if (!emittedFallbackWarnings.has(warningSignature)) {
        emittedFallbackWarnings.add(warningSignature);
        const message = "No active entitlement found, falling back to default tier";
        const meta = {
          userId,
          area,
          error: error?.message,
          rowCount: data?.length ?? 0,
        };

        if (isE2eLoggingContext()) {
          log.info(message, meta);
        } else {
          log.warn(message, meta);
        }
      }

      return DEFAULT_TIER;
    }

    const valid = (data as EntitlementTierRow[]).find((row) => {
      if (!row.tier) {
        return false;
      }
      if (!row.expires_at) {
        return false;
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
