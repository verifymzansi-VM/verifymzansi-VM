import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSelect, mockCreateAdminClient } = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn(() => ({ select: mockSelect }));
  const mockCreateAdminClient = vi.fn(() => ({ from: mockFrom }));
  return { mockSelect, mockCreateAdminClient };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

import { getKycOverviewMetrics, getRejectionBreakdown } from "./kyc-metrics";

describe("getKycOverviewMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zero metrics when no data exists", async () => {
    const chain = {
      gte: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], count: 0 }),
    };
    mockSelect.mockReturnValue(chain);

    const metrics = await getKycOverviewMetrics(30);
    expect(metrics.totalSessions).toBe(0);
    expect(metrics.completionRate).toBe(0);
    expect(metrics.riskDistribution).toEqual({ low: 0, medium: 0, high: 0, critical: 0 });
  });
});

describe("getRejectionBreakdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no rejections", async () => {
    const chain = {
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [] }),
    };
    mockSelect.mockReturnValue(chain);

    const breakdown = await getRejectionBreakdown();
    expect(breakdown).toEqual([]);
  });

  it("groups rejections by reason code", async () => {
    const chain = {
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [
          { override_reason_code: "BLURRY_ID" },
          { override_reason_code: "BLURRY_ID" },
          { override_reason_code: "FRAUDULENT" },
          { override_reason_code: null },
        ],
      }),
    };
    mockSelect.mockReturnValue(chain);

    const breakdown = await getRejectionBreakdown();
    expect(breakdown).toHaveLength(3);
    expect(breakdown[0].reasonCode).toBe("BLURRY_ID");
    expect(breakdown[0].count).toBe(2);
    expect(breakdown[0].percentage).toBe(50);
  });
});
