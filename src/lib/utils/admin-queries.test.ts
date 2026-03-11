import { describe, it, expect, vi, beforeEach } from "vitest";

/** Create a mock that acts like a Supabase PostgREST builder (chainable + thenable) */
function createChainableMock(resolvedValue: unknown = { data: [], count: 0 }) {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === "then") {
        // Make it thenable so await resolves to our value
        return (resolve: (v: unknown) => void) => resolve(resolvedValue);
      }
      // Any method call returns the proxy itself (chainable)
      return vi.fn().mockReturnValue(new Proxy({}, handler));
    },
  };
  return new Proxy({}, handler);
}

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}));

import {
  getAdminDashboardStats,
  getAreaCardCounts,
  getDashboardKycQueue,
  getExtendedPlatformStats,
  getPendingVerifications,
  getRecentActivity,
  getAreaReports,
  getPendingContent,
  getActionsToday,
} from "./admin-queries";

describe("admin-queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAdminDashboardStats", () => {
    it("returns aggregated stats from all tables", async () => {
      mockFrom.mockReturnValue(createChainableMock({ count: 5 }));

      const stats = await getAdminDashboardStats();

      expect(stats.totalAccounts).toBe(5);
      expect(stats.totalMembers).toBe(5);
      expect(stats.totalListings).toBe(5);
      expect(stats.openReports).toBe(5);
      expect(typeof stats.pendingVerifications).toBe("number");
    });

    it("defaults counts to 0 when null", async () => {
      mockFrom.mockReturnValue(createChainableMock({ count: null }));

      const stats = await getAdminDashboardStats();

      expect(stats.totalAccounts).toBe(0);
      expect(stats.totalMembers).toBe(0);
      expect(stats.openReports).toBe(0);
    });
  });

  describe("getAreaCardCounts", () => {
    it("returns per-area flag and content counts", async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === "reports") {
          return createChainableMock({
            data: [
              { target_type: "listing" },
              { target_type: "account_profile" },
              { target_type: "listing" },
              { target_type: "business_profile" },
            ],
          });
        }
        // Content tables: resolve with count
        return createChainableMock({ count: 2 });
      });

      const counts = await getAreaCardCounts();

      expect(counts.MZANSI_MARKET.pendingFlags).toBe(3);
      expect(counts.MZANSI_BUSINESS.pendingFlags).toBe(1);
      expect(counts.BUSINESS_ADS.pendingFlags).toBe(0);
      expect(counts.MALL_SHOPS.pendingFlags).toBe(0);
    });
  });

  describe("getPendingVerifications", () => {
    it("returns empty array when no pending steps", async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null }));

      const result = await getPendingVerifications();
      expect(result).toEqual([]);
    });

    it("enriches steps with account profile data", async () => {
      const steps = [
        {
          id: "s1",
          user_id: "u1",
          step_type: "phone",
          status: "pending",
          created_at: "2024-01-01",
        },
      ];
      const profiles = [
        {
          user_id: "u1",
          display_name: "Thabo",
          account_verification_status: "pending_review",
        },
      ];

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createChainableMock({ data: steps });
        }
        return createChainableMock({ data: profiles });
      });

      const result = await getPendingVerifications();
      expect(result).toHaveLength(1);
      expect(result[0].account_display_name).toBe("Thabo");
      expect(result[0].account_verification_status).toBe("pending_review");
      expect(result[0].account_display_name).toBe("Thabo");
    });
  });

  describe("getDashboardKycQueue", () => {
    it("prefers account verification status when present", async () => {
      const steps = [
        {
          id: "k1",
          user_id: "u1",
          step_type: "location",
          status: "pending",
          created_at: "2024-01-01",
        },
      ];
      const profiles = [
        {
          user_id: "u1",
          display_name: "Ayanda",
          account_verification_status: "verified",
          account_status: "active",
          strikes: 1,
        },
      ];

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createChainableMock({ data: steps });
        }
        return createChainableMock({ data: profiles });
      });

      const result = await getDashboardKycQueue();
      expect(result).toHaveLength(1);
      expect(result[0].account_display_name).toBe("Ayanda");
      expect(result[0].account_verification_status).toBe("verified");
      expect(result[0].account_strikes).toBe(1);
    });
  });

  describe("getRecentActivity", () => {
    it("returns audit log entries", async () => {
      const entries = [
        { id: "a1", actor_id: "u1", action: "user_login", created_at: "2024-01-01" },
      ];
      mockFrom.mockReturnValue(createChainableMock({ data: entries }));

      const result = await getRecentActivity(10);
      expect(result).toHaveLength(1);
      expect(result[0].action).toBe("user_login");
    });

    it("returns empty when no entries", async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null }));

      const result = await getRecentActivity(10, "MZANSI_MARKET");
      expect(result).toEqual([]);
    });
  });

  describe("getAreaReports", () => {
    it("fetches reports by area target type", async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [{ id: "r1", status: "open" }] }));

      const result = await getAreaReports("MZANSI_MARKET");
      expect(result).toHaveLength(1);
      expect(mockFrom).toHaveBeenCalledWith("reports");
    });
  });

  describe("getPendingContent", () => {
    it("fetches pending moderation content for area", async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [{ id: "l1" }] }));

      const result = await getPendingContent("MZANSI_MARKET");
      expect(result).toHaveLength(1);
      expect(mockFrom).toHaveBeenCalledWith("listings");
    });

    it("uses correct table for BUSINESS_ADS", async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [] }));
      await getPendingContent("BUSINESS_ADS");
      expect(mockFrom).toHaveBeenCalledWith("businesses");
    });

    it("uses correct table for MALL_SHOPS", async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [] }));
      await getPendingContent("MALL_SHOPS");
      expect(mockFrom).toHaveBeenCalledWith("businesses");
    });
  });

  describe("getActionsToday", () => {
    it("counts actions grouped by type", async () => {
      mockFrom.mockReturnValue(
        createChainableMock({
          data: [{ action: "warning" }, { action: "warning" }, { action: "ban" }],
        })
      );

      const counts = await getActionsToday();
      expect(counts.warning).toBe(2);
      expect(counts.ban).toBe(1);
    });

    it("returns empty object when no actions", async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [] }));
      const counts = await getActionsToday();
      expect(counts).toEqual({});
    });
  });

  describe("getExtendedPlatformStats", () => {
    it("counts verified accounts through the neutral-or-legacy verification fields", async () => {
      mockFrom.mockReturnValue(createChainableMock({ count: 7 }));

      const stats = await getExtendedPlatformStats();

      expect(stats.verifiedAccounts).toBe(7);
      expect(stats.verifiedMembers).toBe(7);
      expect(stats.bannedAccounts).toBe(7);
      expect(stats.bannedMembers).toBe(7);
    });
  });
});
