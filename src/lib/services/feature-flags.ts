/**
 * Feature flags service — database-backed feature toggles with staged canary.
 * Supports modes: off, on, percent (deterministic bucketing), allowlist.
 * Uses an in-memory TTL cache to avoid hitting the DB on every check.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import type { FeatureFlagMode } from "@/types/database";

const log = createLogger("FeatureFlags");

interface FlagRow {
  enabled: boolean;
  mode: FeatureFlagMode | null;
  rollout_percent: number | null;
  allowlist_roles: string[] | null;
}

interface CacheEntry {
  value: FlagRow;
  expiresAt: number;
}

/** Optional context for percent/allowlist evaluation. */
export interface FlagContext {
  userId?: string;
  role?: string;
  bucketKey?: string;
}

const FLAG_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 60 seconds
const MAX_FLAG_CACHE_SIZE = 200; // Defensive cap on cache entries

/**
 * Evict the oldest cache entry if the cache exceeds the maximum size.
 */
function evictOldestIfNeeded(): void {
  if (FLAG_CACHE.size > MAX_FLAG_CACHE_SIZE) {
    const oldest = FLAG_CACHE.keys().next().value;
    if (oldest !== undefined) FLAG_CACHE.delete(oldest);
  }
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
 * Check if a feature flag is enabled.
 * Results are cached for 60 seconds to minimize DB queries.
 */
export async function isFeatureEnabled(key: string, context?: FlagContext): Promise<boolean> {
  const now = Date.now();
  const cached = FLAG_CACHE.get(key);

  if (cached && cached.expiresAt > now) {
    return evaluateFlag(cached.value, key, context);
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("feature_flags")
      .select("enabled, mode, rollout_percent, allowlist_roles")
      .eq("key", key)
      .single();

    if (error || !data) {
      log.warn(`Flag "${key}" query returned no data`, {
        error: error?.message ?? "no row",
      });
      // Prefer stale cached value over hardcoded false
      if (cached) return evaluateFlag(cached.value, key, context);
      const fallback: FlagRow = {
        enabled: false,
        mode: "off",
        rollout_percent: 0,
        allowlist_roles: [],
      };
      FLAG_CACHE.set(key, { value: fallback, expiresAt: now + CACHE_TTL_MS });
      evictOldestIfNeeded();
      return false;
    }

    FLAG_CACHE.set(key, {
      value: data as FlagRow,
      expiresAt: now + CACHE_TTL_MS,
    });
    evictOldestIfNeeded();

    return evaluateFlag(data as FlagRow, key, context);
  } catch (err) {
    log.error(`Failed to check flag "${key}"`, {
      error: err instanceof Error ? err.message : "unknown error",
    });
    // On error, return cached value if available (even if expired), otherwise false
    if (cached) return evaluateFlag(cached.value, key, context);
    return false;
  }
}

/**
 * Toggle a feature flag (legacy boolean mode).
 * Sets mode to 'on' or 'off' accordingly.
 */
export async function toggleFeatureFlag(
  key: string,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createAdminClient();
    const { error, data } = await supabase
      .from("feature_flags")
      .update({ enabled, mode: enabled ? "on" : "off" })
      .eq("key", key)
      .select("key");

    if (error) {
      return { success: false, error: error.message };
    }
    if (!data || data.length === 0) {
      return { success: false, error: `Flag "${key}" does not exist` };
    }

    // Invalidate cache immediately
    FLAG_CACHE.delete(key);

    return { success: true };
  } catch (err) {
    log.error(`Failed to toggle flag "${key}"`, {
      error: err instanceof Error ? err.message : "unknown error",
    });
    return { success: false, error: "Internal error toggling flag" };
  }
}

/**
 * Update a feature flag with canary configuration.
 */
export async function updateFeatureFlagConfig(
  key: string,
  config: {
    mode: "off" | "on" | "percent" | "allowlist";
    percent?: number;
    allowlistRoles?: string[];
    updatedBy?: string;
    reason?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createAdminClient();
    const { error, data } = await supabase
      .from("feature_flags")
      .update({
        mode: config.mode,
        enabled: config.mode !== "off",
        rollout_percent: config.percent ?? 0,
        allowlist_roles: config.allowlistRoles ?? [],
        updated_by: config.updatedBy ?? null,
        updated_reason: config.reason ?? null,
      })
      .eq("key", key)
      .select("key");

    if (error) {
      return { success: false, error: error.message };
    }
    if (!data || data.length === 0) {
      return { success: false, error: `Flag "${key}" does not exist` };
    }

    FLAG_CACHE.delete(key);
    return { success: true };
  } catch (err) {
    log.error(`Failed to update flag config "${key}"`, {
      error: err instanceof Error ? err.message : "unknown error",
    });
    return { success: false, error: "Internal error updating flag config" };
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
  }>
> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("feature_flags")
      .select(
        "id, key, enabled, description, mode, rollout_percent, allowlist_roles, updated_at, updated_reason"
      )
      .order("key", { ascending: true });

    if (error) {
      log.error("Failed to list flags", { error: error?.message });
      return [];
    }

    return data || [];
  } catch (err) {
    log.error("Failed to list flags", {
      error: err instanceof Error ? err.message : "unknown error",
    });
    return [];
  }
}

/**
 * Clear the in-memory flag cache. Useful for testing.
 */
export function clearFlagCache(): void {
  FLAG_CACHE.clear();
}
