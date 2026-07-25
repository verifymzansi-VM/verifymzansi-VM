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

  it("counts completed sessions via finalized_at and pending steps via status = pending", async () => {
    const chain = {
      gte: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], count: 0 }),
    };
    mockSelect.mockReturnValue(chain);

    await getKycOverviewMetrics(30);

    // verification_sessions has no status column — completion is finalized_at
    expect(chain.not).toHaveBeenCalledWith("finalized_at", "is", null);
    // verification_steps.status is NOT NULL DEFAULT 'pending' — is-null never matches
    expect(chain.eq).toHaveBeenCalledWith("status", "pending");
    expect(chain.is).not.toHaveBeenCalledWith("status", null);
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
          { reason_code: "BLURRY_ID" },
          { reason_code: "BLURRY_ID" },
          { reason_code: "FRAUDULENT" },
          { reason_code: null },
        ],
      }),
    };
    mockSelect.mockReturnValue(chain);

    const breakdown = await getRejectionBreakdown();
    // The decide route writes rejection reasons to reason_code
    expect(mockSelect).toHaveBeenCalledWith("reason_code");
    expect(breakdown).toHaveLength(3);
    expect(breakdown[0].reasonCode).toBe("BLURRY_ID");
    expect(breakdown[0].count).toBe(2);
    expect(breakdown[0].percentage).toBe(50);
  });
});
