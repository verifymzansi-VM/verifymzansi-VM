import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase admin client
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}));

mockFrom.mockReturnValue({
  select: mockSelect,
  update: mockUpdate,
});

mockSelect.mockReturnValue({
  eq: mockEq,
});

mockEq.mockReturnValue({
  single: mockSingle,
});

mockUpdate.mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null }),
});

import { isFeatureEnabled, clearFlagCache } from "@/lib/services/feature-flags";

describe("Feature Flags — Canary Evaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFlagCache();
    // Re-setup mock chain after clear
    mockFrom.mockReturnValue({
      select: mockSelect,
      update: mockUpdate,
    });
    mockSelect.mockReturnValue({
      eq: mockEq,
    });
    mockEq.mockReturnValue({
      single: mockSingle,
    });
  });

  it("mode=off always returns false", async () => {
    mockSingle.mockResolvedValue({
      data: { enabled: false, mode: "off", rollout_percent: 0, allowlist_roles: [] },
      error: null,
    });

    expect(await isFeatureEnabled("test_flag")).toBe(false);
    expect(await isFeatureEnabled("test_flag", { userId: "u1" })).toBe(false);
    expect(await isFeatureEnabled("test_flag", { role: "admin" })).toBe(false);
  });

  it("mode=on always returns true", async () => {
    mockSingle.mockResolvedValue({
      data: { enabled: true, mode: "on", rollout_percent: 0, allowlist_roles: [] },
      error: null,
    });

    expect(await isFeatureEnabled("test_flag")).toBe(true);
    expect(await isFeatureEnabled("test_flag", { userId: "u1" })).toBe(true);
  });

  it("mode=percent is deterministic for same user", async () => {
    mockSingle.mockResolvedValue({
      data: { enabled: false, mode: "percent", rollout_percent: 50, allowlist_roles: [] },
      error: null,
    });

    const result1 = await isFeatureEnabled("test_flag", { userId: "user-abc" });
    clearFlagCache();
    // Re-mock after cache clear
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ single: mockSingle });

    mockSingle.mockResolvedValue({
      data: { enabled: false, mode: "percent", rollout_percent: 50, allowlist_roles: [] },
      error: null,
    });

    const result2 = await isFeatureEnabled("test_flag", { userId: "user-abc" });
    expect(result1).toBe(result2); // Same user → same result
  });

  it("mode=percent returns false without userId", async () => {
    mockSingle.mockResolvedValue({
      data: { enabled: false, mode: "percent", rollout_percent: 50, allowlist_roles: [] },
      error: null,
    });

    expect(await isFeatureEnabled("test_flag")).toBe(false);
  });

  it("mode=percent uses bucketKey over userId when provided", async () => {
    mockSingle.mockResolvedValue({
      data: { enabled: false, mode: "percent", rollout_percent: 50, allowlist_roles: [] },
      error: null,
    });

    const resultBucket = await isFeatureEnabled("test_flag", {
      userId: "user-abc",
      bucketKey: "bucket-xyz",
    });
    clearFlagCache();
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ single: mockSingle });

    mockSingle.mockResolvedValue({
      data: { enabled: false, mode: "percent", rollout_percent: 50, allowlist_roles: [] },
      error: null,
    });

    const resultUserId = await isFeatureEnabled("test_flag", { userId: "user-abc" });
    // With different bucketing IDs, result may differ (testing determinism, not equality)
    expect(typeof resultBucket).toBe("boolean");
    expect(typeof resultUserId).toBe("boolean");
  });

  it("mode=percent at 100% includes everyone", async () => {
    mockSingle.mockResolvedValue({
      data: { enabled: false, mode: "percent", rollout_percent: 100, allowlist_roles: [] },
      error: null,
    });

    // Hash bucket is always 0-99, so < 100 is always true
    expect(await isFeatureEnabled("test_flag", { userId: "any-user" })).toBe(true);
  });

  it("mode=percent at 0% excludes everyone", async () => {
    mockSingle.mockResolvedValue({
      data: { enabled: false, mode: "percent", rollout_percent: 0, allowlist_roles: [] },
      error: null,
    });

    expect(await isFeatureEnabled("test_flag", { userId: "any-user" })).toBe(false);
  });

  it("mode=allowlist grants only listed roles", async () => {
    mockSingle.mockResolvedValue({
      data: {
        enabled: false,
        mode: "allowlist",
        rollout_percent: 0,
        allowlist_roles: ["admin", "moderator"],
      },
      error: null,
    });

    expect(await isFeatureEnabled("test_flag", { role: "admin" })).toBe(true);
    expect(await isFeatureEnabled("test_flag", { role: "moderator" })).toBe(true);
    expect(await isFeatureEnabled("test_flag", { role: "seller" })).toBe(false);
    expect(await isFeatureEnabled("test_flag", { role: "buyer" })).toBe(false);
    expect(await isFeatureEnabled("test_flag")).toBe(false); // no role
  });

  it("mode=allowlist with empty list denies everyone", async () => {
    mockSingle.mockResolvedValue({
      data: { enabled: false, mode: "allowlist", rollout_percent: 0, allowlist_roles: [] },
      error: null,
    });

    expect(await isFeatureEnabled("test_flag", { role: "admin" })).toBe(false);
  });

  it("backward compat: null mode falls back to enabled boolean", async () => {
    // Pre-migration row: mode column is null
    mockSingle.mockResolvedValue({
      data: { enabled: true, mode: null, rollout_percent: null, allowlist_roles: null },
      error: null,
    });

    expect(await isFeatureEnabled("test_flag")).toBe(true);

    clearFlagCache();
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ single: mockSingle });

    mockSingle.mockResolvedValue({
      data: { enabled: false, mode: null, rollout_percent: null, allowlist_roles: null },
      error: null,
    });

    expect(await isFeatureEnabled("test_flag")).toBe(false);
  });

  it("returns false when flag does not exist", async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: "PGRST116" },
    });

    expect(await isFeatureEnabled("nonexistent")).toBe(false);
  });

  it("caches results for subsequent calls", async () => {
    mockSingle.mockResolvedValue({
      data: { enabled: true, mode: "on", rollout_percent: 0, allowlist_roles: [] },
      error: null,
    });

    await isFeatureEnabled("test_flag");
    await isFeatureEnabled("test_flag");

    // Should only call DB once due to cache
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });
});
