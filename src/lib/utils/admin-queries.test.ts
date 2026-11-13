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
const { readRestoredStaffVerificationQueue, readNativeAreaActivity, readNativeProgramReports } =
  vi.hoisted(() => ({
    readRestoredStaffVerificationQueue: vi.fn(),
    readNativeAreaActivity: vi.fn(),
    readNativeProgramReports: vi.fn(),
  }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));
vi.mock("@/lib/foundation/staff-verification-server", () => ({
  readRestoredStaffVerificationQueue,
}));
vi.mock("@/lib/foundation/area-activity-server", () => ({
  readNativeAreaActivity,
  readNativeProgramReports,
}));

import {
  countPendingVerifications,
  getActionsToday,
  getAreaReports,
  getPendingContent,
  getPendingVerificationGroups,
  getRecentActivity,
} from "./admin-queries";

describe("admin-queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("foundation staff reads", () => {
    it("reads the identity queue with a bounded page and the claimed steps", async () => {
      readRestoredStaffVerificationQueue.mockResolvedValue({
        total: 7,
        groups: [{ user_id: "u" }],
      });
      await expect(countPendingVerifications()).resolves.toBe(7);
      await expect(getPendingVerificationGroups(500, { includeIds: ["s1"] })).resolves.toEqual([
        { user_id: "u" },
      ]);
      expect(readRestoredStaffVerificationQueue).toHaveBeenLastCalledWith(100, '["s1"]');
    });

    it("reads area activity, today's actions and open reports", async () => {
      readNativeAreaActivity.mockResolvedValue({ items: [{ id: "a" }], today: { approve: 2 } });
      readNativeProgramReports.mockResolvedValue({ open: [{ id: "r" }] });
      await expect(getRecentActivity(5, "MZANSI_MARKET")).resolves.toEqual([{ id: "a" }]);
      expect(readNativeAreaActivity).toHaveBeenCalledWith("MZANSI_MARKET", 5);
      await expect(getActionsToday("MZANSI_MARKET")).resolves.toEqual({ approve: 2 });
      await expect(getAreaReports("MZANSI_MARKET")).resolves.toEqual([{ id: "r" }]);
      expect(readNativeProgramReports).toHaveBeenCalledWith("MZANSI_MARKET");
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

    it("says so when new posts cannot be read, instead of showing an empty queue", async () => {
      mockFrom.mockImplementation((table: string) =>
        createChainableMock(
          table === "listings" ? { data: null, error: { message: "timeout" } } : { data: [] }
        )
      );
      await expect(getPendingContent("MZANSI_MARKET")).rejects.toThrow(
        "Failed to load pending content"
      );
    });

    it("fetches pending events and tourism businesses for PROMOTIONS_EVENTS", async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [] }));
      await getPendingContent("PROMOTIONS_EVENTS");
      expect(mockFrom).toHaveBeenCalledWith("promotions");
      expect(mockFrom).toHaveBeenCalledWith("businesses");
    });
  });
});
