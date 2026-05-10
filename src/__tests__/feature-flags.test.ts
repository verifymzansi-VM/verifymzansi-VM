import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase admin client
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockUpsert = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateEq = vi.fn();
const mockUpdateSelect = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}));

mockFrom.mockReturnValue({
  select: mockSelect,
  upsert: mockUpsert,
  update: mockUpdate,
});

mockSelect.mockReturnValue({
  eq: mockEq,
});

mockEq.mockReturnValue({
  single: mockSingle,
});

mockUpdate.mockReturnValue({
  eq: mockUpdateEq,
});

mockUpdateEq.mockReturnValue({
  select: mockUpdateSelect,
});

import {
  isFeatureEnabled,
  clearFlagCache,
  updateFeatureFlagConfig,
} from "@/lib/services/feature-flags";

describe("Feature Flags Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFlagCache();
    mockFrom.mockReturnValue({
      select: mockSelect,
      upsert: mockUpsert,
      update: mockUpdate,
    });
    mockSelect.mockReturnValue({
      eq: mockEq,
    });
    mockEq.mockReturnValue({
      single: mockSingle,
    });
    mockUpdate.mockReturnValue({
      eq: mockUpdateEq,
    });
    mockUpdateEq.mockReturnValue({
      select: mockUpdateSelect,
    });
  });

  it("returns true when flag is enabled", async () => {
    mockSingle.mockResolvedValue({
      data: { enabled: true },
      error: null,
    });

    const result = await isFeatureEnabled("kyc_v2_flow");
    expect(result).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith("feature_flags");
  });

  it("returns false when flag is disabled", async () => {
    mockSingle.mockResolvedValue({
      data: { enabled: false },
      error: null,
    });

    const result = await isFeatureEnabled("kyc_v2_flow");
    expect(result).toBe(false);
  });

  it("returns false when flag does not exist", async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: "PGRST116" },
    });

    const result = await isFeatureEnabled("nonexistent_flag");
    expect(result).toBe(false);
  });

  it("caches results and reuses them", async () => {
    mockSingle.mockResolvedValue({
      data: { enabled: true },
      error: null,
    });

    await isFeatureEnabled("kyc_v2_flow");
    await isFeatureEnabled("kyc_v2_flow");

    // Should only call DB once due to cache
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("fetches again after cache is cleared", async () => {
    mockSingle.mockResolvedValue({
      data: { enabled: true },
      error: null,
    });

    await isFeatureEnabled("kyc_v2_flow");
    clearFlagCache();
    await isFeatureEnabled("kyc_v2_flow");

    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it("returns an error when updating a nonexistent flag config", async () => {
    mockUpdateSelect.mockResolvedValue({ data: [], error: null });

    const result = await updateFeatureFlagConfig("missing_flag", {
      mode: "percent",
      percent: 25,
    });

    expect(result).toEqual({
      success: false,
      error: 'Flag "missing_flag" does not exist',
    });
  });

  it("updates an existing flag config", async () => {
    mockUpdateSelect.mockResolvedValue({ data: [{ key: "kyc_v2_flow" }], error: null });

    const result = await updateFeatureFlagConfig("kyc_v2_flow", {
      mode: "allowlist",
      allowlistRoles: ["admin"],
      updatedBy: "user-1",
      reason: "canary",
    });

    expect(result).toEqual({ success: true });
    expect(mockUpdateEq).toHaveBeenCalledWith("key", "kyc_v2_flow");
  });
});
