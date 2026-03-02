import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase admin client
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockUpsert = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}));

mockFrom.mockReturnValue({
  select: mockSelect,
  upsert: mockUpsert,
});

mockSelect.mockReturnValue({
  eq: mockEq,
});

mockEq.mockReturnValue({
  single: mockSingle,
});

import { isFeatureEnabled, clearFlagCache } from "@/lib/services/feature-flags";

describe("Feature Flags Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFlagCache();
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
});
