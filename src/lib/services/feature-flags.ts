/**
 * Feature flags, read from the foundation's audited feature controls.
 * Supports modes: off, on, percent (deterministic bucketing), allowlist.
 * Changes go through the native audited settings endpoint.
 */

import { createLogger } from "@/lib/utils/logger";
import type { FeatureFlagMode } from "@/types/database";

const log = createLogger("FeatureFlags");

interface FlagRow {
  enabled: boolean;
  mode: FeatureFlagMode | null;
  rollout_percent: number | null;
  allowlist_roles: string[] | null;
}

/** Optional context for percent/allowlist evaluation. */
export interface FlagContext {
  userId?: string;
  role?: string;
  bucketKey?: string;
}

/**
 * Deterministic percent bucketing using FNV-1a hash.
 * Same (key + bucketId) always maps to the same 0-99 bucket.
 */
function hashBucket(key: string, bucketId: string): number {
  const str = `${key}:${bucketId}`;
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return Math.abs(hash) % 100;
}

/**
 * Evaluate a flag row with optional context.
 * Backward compatible: if `mode` is null (pre-migration), falls back to `enabled`.
 */
function evaluateFlag(flag: FlagRow, flagKey: string, context?: FlagContext): boolean {
  const mode = flag.mode ?? (flag.enabled ? "on" : "off");

  switch (mode) {
    case "on":
      return true;
    case "off":
      return false;
    case "percent": {
      const bucketId = context?.bucketKey || context?.userId;
      if (!bucketId) return false; // No identifier — deny
      if (flag.rollout_percent == null) {
        log.error(`Flag "${flagKey}" is in percent mode but rollout_percent is null — denying`);
        return false;
      }
      const percent = flag.rollout_percent;
      return hashBucket(flagKey, bucketId) < percent;
    }
    case "allowlist": {
      const roles = flag.allowlist_roles ?? [];
      return context?.role ? roles.includes(context.role) : false;
    }
    default:
      return false;
  }
}

/**
 * Check if a feature flag is enabled. Only the evidence desk flag is served
 * by the foundation; every other key, and any read failure, reads as off.
 */
export async function isFeatureEnabled(key: string, context?: FlagContext): Promise<boolean> {
  if (key !== "kyc_evidence_desk") return false;
  try {
    const { readNativeDisplayFlags } = await import("@/lib/foundation/feature-controls-server");
    const flag = (await readNativeDisplayFlags()).find((f) => f.key === key);
    return flag ? evaluateFlag(flag, key, context) : false;
  } catch {
    return false;
  }
}

/**
 * Get all feature flags with their current state.
 */
export async function getAllFeatureFlags(): Promise<
  Array<{
    id: string;
    key: string;
    enabled: boolean;
    description: string | null;
    mode: FeatureFlagMode | null;
    rollout_percent: number | null;
    allowlist_roles: string[] | null;
    updated_at: string;
    updated_reason: string | null;
    revision?: number;
  }>
> {
  const { readNativeAdminFlags } = await import("@/lib/foundation/feature-controls-server");
  return readNativeAdminFlags();
}
