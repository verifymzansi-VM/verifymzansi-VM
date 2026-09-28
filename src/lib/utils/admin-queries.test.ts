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
  getPendingVerificationGroups,
  getPendingVerifications,
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
      mockFrom.mockReturnValue(
        createChainableMock({ data: [{ id: "r1", status: "open", target_type: "listing" }] })
      );

      const result = await getAreaReports("MZANSI_MARKET");
      expect(result).toHaveLength(1);
      expect(mockFrom).toHaveBeenCalledWith("reports");
    });

    it("prefers the explicit report area over the target type", async () => {
      mockFrom.mockReturnValue(
        createChainableMock({
          data: [
            { id: "r1", status: "open", target_type: "listing", area: "MZANSI_BUSINESS" },
            { id: "r2", status: "open", target_type: "listing", area: "MZANSI_MARKET" },
          ],
        })
      );

      const result = await getAreaReports("MZANSI_MARKET");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("r2");
    });

    it("includes business-profile and storefront reports in the Mzansi Business area", async () => {
      mockFrom.mockReturnValue(
        createChainableMock({
          data: [
            { id: "r1", status: "open", target_type: "business" },
            { id: "r2", status: "open", target_type: "business_profile" },
            { id: "r3", status: "open", target_type: "storefront" },
            { id: "r4", status: "open", target_type: "listing" },
          ],
        })
      );

      const result = await getAreaReports("MZANSI_BUSINESS");
      expect(result.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    });
  });

  describe("getPendingContent", () => {
    it.each([
      ["MZANSI_MARKET", "listing"],
      ["MZANSI_BUSINESS", "business"],
      ["PROMOTIONS_EVENTS", "promotion"],
      ["PROMOTIONS_EVENTS", "business"],
    ] as const)(
      "includes pending %s %s edits even when no new posts await review",
      async (area, targetType) => {
        const edits = createChainableMock({
          data: [
            {
              id: "edit-1",
              target_id: "post-1",
              target_type: targetType,
              owner_id: "owner",
              area,
              status: "pending",
              created_at: "2026-09-12T12:00:00Z",
              proposed_data: { title: "Changed title" },
              current_snapshot: { title: "Live title" },
            },
          ],
          error: null,
        });
        mockFrom.mockImplementation((table: string) =>
          table === "content_edit_requests" ? edits : createChainableMock({ data: [] })
        );
        const result = await getPendingContent(area);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
          id: "edit-1",
          targetId: "post-1",
          isEditRequest: true,
          contentType: targetType,
          title: "Changed title",
          change_summary: [{ field: "title", before: "Live title", after: "Changed title" }],
        });
      }
    );

    it("does not silently present a failed edit query as an empty queue", async () => {
      mockFrom.mockImplementation((table: string) =>
        createChainableMock(
          table === "content_edit_requests"
            ? { error: { message: "unavailable" }, data: null }
            : { data: [] }
        )
      );
      await expect(getPendingContent("MZANSI_BUSINESS")).rejects.toThrow(
        "Failed to load pending post edits"
      );
    });

    it("fetches pending moderation content for area", async () => {
      mockFrom.mockImplementation((table: string) =>
        createChainableMock({ data: table === "listings" ? [{ id: "l1" }] : [] })
      );

      const result = await getPendingContent("MZANSI_MARKET");
      expect(result).toHaveLength(1);
      expect(mockFrom).toHaveBeenCalledWith("listings");
    });

    it("fetches pending events and tourism businesses for PROMOTIONS_EVENTS", async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [] }));
      await getPendingContent("PROMOTIONS_EVENTS");
      expect(mockFrom).toHaveBeenCalledWith("promotions");
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
});
