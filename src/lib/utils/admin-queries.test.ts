import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  readRestoredStaffVerificationQueue,
  readNativeAreaActivity,
  readNativeProgramReports,
  readFoundationServerSession,
  readStaffModerationQueue,
} = vi.hoisted(() => ({
  readRestoredStaffVerificationQueue: vi.fn(),
  readNativeAreaActivity: vi.fn(),
  readNativeProgramReports: vi.fn(),
  readFoundationServerSession: vi.fn(),
  readStaffModerationQueue: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));
vi.mock("@/lib/foundation/server-session", () => ({ readFoundationServerSession }));
vi.mock("@/lib/foundation/staff-moderation-queue", () => ({ readStaffModerationQueue }));
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
    const item = (id: string, area: string, itemType: string) => ({ id, area, itemType });
    const queue = [
      item("l1", "MZANSI_MARKET", "Listing"),
      item("b1", "MZANSI_BUSINESS", "Business"),
      item("e1", "PROMOTIONS_EVENTS", "Event"),
      item("t1", "PROMOTIONS_EVENTS", "Tourism business"),
    ];

    it.each([
      ["MZANSI_MARKET", ["l1"]],
      ["MZANSI_BUSINESS", ["b1"]],
      ["PROMOTIONS_EVENTS", ["e1", "t1"]],
    ] as const)("keeps only the %s posts of the shared queue", async (area, ids) => {
      readFoundationServerSession.mockResolvedValue({ api: {}, user: { id: "staff-1" } });
      readStaffModerationQueue.mockResolvedValue({ allItems: queue });
      const result = await getPendingContent(area);
      expect(result.map((i) => i.id)).toEqual(ids);
      // The area is asked of the database, so the 50-row limit applies per area.
      expect(readStaffModerationQueue.mock.calls.at(-1)?.[2]).toBe(
        {
          MZANSI_MARKET: "market",
          MZANSI_BUSINESS: "business",
          PROMOTIONS_EVENTS: "tourism_events",
        }[area]
      );
      expect(readStaffModerationQueue).toHaveBeenCalledWith({}, "staff-1", expect.any(String));
    });

    it("says so when the queue cannot be read, instead of showing an empty queue", async () => {
      readFoundationServerSession.mockResolvedValue({ api: {}, user: { id: "staff-1" } });
      readStaffModerationQueue.mockRejectedValue(new Error("unavailable"));
      await expect(getPendingContent("MZANSI_MARKET")).rejects.toThrow("unavailable");
    });
  });
});
