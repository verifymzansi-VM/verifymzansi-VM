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
const mockGetUserById = vi.fn();
const mockEnsureAccountProfile = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mockFrom,
    auth: {
      admin: {
        getUserById: mockGetUserById,
      },
    },
  }),
}));

vi.mock("@/lib/account/ensure-profile", () => ({
  ensureAccountProfile: (...args: unknown[]) => mockEnsureAccountProfile(...args),
}));

import {
  getAdminDashboardStats,
  getAreaCardCounts,
  getDashboardKycQueue,
  getExtendedPlatformStats,
  getPendingVerificationGroups,
  getPendingVerifications,
  getPendingModerationCount,
  getRecentOtpAttempts,
  getRecentActivity,
  getAreaReports,
  getPendingContent,
  getActionsToday,
} from "./admin-queries";

describe("admin-queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserById.mockResolvedValue({ data: { user: null }, error: null });
    mockEnsureAccountProfile.mockResolvedValue(null);
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
      expect(stats.pendingModeration).toBe(15);
    });

    it("defaults counts to 0 when null", async () => {
      mockFrom.mockReturnValue(createChainableMock({ count: null }));

      const stats = await getAdminDashboardStats();

      expect(stats.totalAccounts).toBe(0);
      expect(stats.totalMembers).toBe(0);
      expect(stats.openReports).toBe(0);
      expect(stats.pendingModeration).toBe(0);
    });

    it("sums pending moderation across listings, businesses, and promotions", async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === "listings") {
          return createChainableMock({ count: 4 });
        }

        if (table === "businesses") {
          return createChainableMock({ count: 3 });
        }

        if (table === "promotions") {
          return createChainableMock({ count: 2 });
        }

        return createChainableMock({ count: 1 });
      });

      const stats = await getAdminDashboardStats();

      expect(stats.pendingModeration).toBe(9);
    });
  });

  describe("getPendingModerationCount", () => {
    it("returns the combined moderation backlog across all public content areas", async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === "listings") {
          return createChainableMock({ count: 7 });
        }

        if (table === "businesses") {
          return createChainableMock({ count: 5 });
        }

        if (table === "promotions") {
          return createChainableMock({ count: 4 });
        }

        return createChainableMock({ count: 0 });
      });

      await expect(getPendingModerationCount()).resolves.toBe(16);
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

  describe("getPendingVerificationGroups", () => {
    it("groups multiple pending steps under one user", async () => {
      const steps = [
        {
          id: "s1",
          user_id: "u1",
          step_type: "selfie",
          status: "pending",
          created_at: "2024-01-01T00:00:00.000Z",
          reviewed_at: null,
          risk_level: null,
          risk_score: null,
          auto_status: null,
        },
        {
          id: "s2",
          user_id: "u1",
          step_type: "id_doc",
          status: "pending",
          created_at: "2024-01-02T00:00:00.000Z",
          reviewed_at: null,
          risk_level: null,
          risk_score: null,
          auto_status: null,
        },
      ];
      const profiles = [
        {
          user_id: "u1",
          display_name: "Thabo Tester",
          account_verification_status: "pending_review",
        },
      ];

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return createChainableMock({ data: steps });
        }

        return createChainableMock({ data: profiles });
      });

      const result = await getPendingVerificationGroups();

      expect(result).toHaveLength(1);
      expect(result[0].user_id).toBe("u1");
      expect(result[0].account_display_name).toBe("Thabo Tester");
      expect(result[0].pending_step_count).toBe(2);
      expect(result[0].steps).toHaveLength(2);
      expect(result[0].steps.map((step) => step.step_type)).toEqual(["id_doc", "selfie"]);
      expect(result[0].primary_step_type).toBe("id_doc");
    });

    it("repairs missing display names using ensureAccountProfile fallback", async () => {
      const steps = [
        {
          id: "s1",
          user_id: "u-repair",
          step_type: "id_doc",
          status: "pending",
          created_at: "2024-01-03T00:00:00.000Z",
          reviewed_at: null,
          risk_level: null,
          risk_score: null,
          auto_status: null,
        },
      ];

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return createChainableMock({ data: steps });
        }

        if (callCount === 2) {
          return createChainableMock({
            data: [
              {
                user_id: "u-repair",
                display_name: "   ",
                account_verification_status: "pending_review",
              },
            ],
          });
        }

        return createChainableMock({
          data: [
            {
              user_id: "u-repair",
              display_name: "Recovered Name",
              account_verification_status: "pending_review",
            },
          ],
        });
      });

      mockGetUserById.mockResolvedValue({
        data: {
          user: {
            id: "u-repair",
            email: "recovered@example.com",
            user_metadata: { display_name: "Recovered Name" },
          },
        },
        error: null,
      });
      mockEnsureAccountProfile.mockResolvedValue({
        id: "profile-repair",
        display_name: "Recovered Name",
      });

      const result = await getPendingVerificationGroups();

      expect(mockGetUserById).toHaveBeenCalledWith("u-repair");
      expect(mockEnsureAccountProfile).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].account_display_name).toBe("Recovered Name");
    });
  });

  describe("getRecentOtpAttempts", () => {
    it("falls back to the approved phone verification timestamp for already-verified phones", async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === "otp_logs") {
          return createChainableMock({
            data: [
              {
                id: "otp-1",
                phone: "+27821234567",
                delivery_status: "sent",
                provider_name: "africastalking",
                provider_message_id: "sms-1",
                provider_error: null,
                verified: false,
                verified_at: null,
                created_at: "2026-03-14T10:12:00.000Z",
                expires_at: "2026-03-14T10:17:00.000Z",
              },
            ],
          });
        }

        if (table === "account_profiles") {
          return createChainableMock({
            data: [{ user_id: "user-1", phone: "+27821234567" }],
          });
        }

        if (table === "verification_steps") {
          return createChainableMock({
            data: [
              {
                user_id: "user-1",
                phone_verified_at: "2026-03-14T10:12:30.000Z",
                status: "approved",
              },
            ],
          });
        }

        return createChainableMock({ data: [] });
      });

      const result = await getRecentOtpAttempts(8);

      expect(result).toHaveLength(1);
      expect(result[0].verified).toBe(true);
      expect(result[0].verified_at).toBe("2026-03-14T10:12:30.000Z");
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

    it("includes business-profile and storefront reports in the Mzansi Business area", async () => {
      const limitSpy = vi.fn().mockResolvedValue({ data: [] });
      const orderSpy = vi.fn().mockReturnValue({ limit: limitSpy });
      const statusInSpy = vi.fn().mockReturnValue({ order: orderSpy });
      const targetTypeInSpy = vi.fn().mockReturnValue({ in: statusInSpy });
      const selectSpy = vi.fn().mockReturnValue({ in: targetTypeInSpy });

      mockFrom.mockImplementation((table: string) => {
        if (table === "reports") {
          return { select: selectSpy };
        }

        return createChainableMock({ data: [] });
      });

      await getAreaReports("MZANSI_BUSINESS");

      expect(targetTypeInSpy).toHaveBeenCalledWith("target_type", [
        "business",
        "business_profile",
        "storefront",
      ]);
      expect(statusInSpy).toHaveBeenCalledWith("status", ["open", "in_progress"]);
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

    it("aggregates live and hidden content across listings, businesses, and promotions", async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === "listings") {
          return createChainableMock({ count: 4 });
        }

        if (table === "businesses") {
          return createChainableMock({ count: 3 });
        }

        if (table === "promotions") {
          return createChainableMock({ count: 2 });
        }

        return createChainableMock({ count: 1 });
      });

      const stats = await getExtendedPlatformStats();

      expect(stats.liveListings).toBe(9);
      expect(stats.hiddenListings).toBe(9);
    });
  });
});
