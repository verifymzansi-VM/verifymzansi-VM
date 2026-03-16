import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
    in: vi.fn().mockResolvedValue({ error: null }),
    gte: vi.fn().mockResolvedValue({ error: null }),
  }),
});

const mockInsert = vi.fn().mockResolvedValue({ error: null });

const mockFrom = vi.fn().mockImplementation((table: string) => {
  if (table === "account_profiles") {
    return {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    };
  }
  if (table === "moderation_actions") {
    return { insert: mockInsert };
  }
  if (table === "listings" || table === "businesses" || table === "promotions") {
    return {
      update: mockUpdate,
    };
  }
  if (table === "reports") {
    return {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    };
  }
  // audit_logs
  return { insert: vi.fn().mockResolvedValue({ error: null }) };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}));

vi.mock("@/lib/account/compat", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getOwnerColumn: vi.fn().mockResolvedValue("owner_id"),
  };
});

vi.mock("./audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { enforceAction } from "./enforcement";

describe("enforcement service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates moderation action record", async () => {
    await enforceAction({
      ownerId: "seller-1",
      action: "warning",
      reason: "First offense",
      moderatorId: "mod-1",
    });

    expect(mockFrom).toHaveBeenCalledWith("moderation_actions");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        target_owner_id: "seller-1",
        action: "warning",
        reason: "First offense",
        actor_id: "mod-1",
      })
    );
  });

  it("updates account profile status for ban", async () => {
    await enforceAction({
      ownerId: "seller-2",
      action: "ban",
      reason: "Fraud",
      moderatorId: "mod-1",
    });

    expect(mockFrom).toHaveBeenCalledWith("account_profiles");
  });

  it("updates listings and businesses to hidden on ban", async () => {
    await enforceAction({
      ownerId: "seller-2",
      action: "ban",
      reason: "Fraud",
      moderatorId: "mod-1",
    });

    expect(mockFrom).toHaveBeenCalledWith("listings");
    expect(mockFrom).toHaveBeenCalledWith("businesses");
  });

  it("logs audit event for ban", async () => {
    const { logAuditEvent } = await import("./audit");

    await enforceAction({
      ownerId: "seller-2",
      action: "ban",
      reason: "Fraud",
      moderatorId: "mod-1",
    });

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "mod-1",
        actorRole: "moderator",
        action: "account_banned",
        targetType: "account_profile",
        targetId: "seller-2",
      })
    );
  });

  it("resolves linked report when reportId is provided", async () => {
    await enforceAction({
      ownerId: "seller-3",
      action: "suspend",
      reason: "Suspicious activity",
      moderatorId: "mod-2",
      reportId: "report-1",
    });

    expect(mockFrom).toHaveBeenCalledWith("reports");
  });

  it("throws when unban target account profile not found", async () => {
    // Override the mock so account_profiles SELECT returns null
    mockFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "listings" || table === "businesses" || table === "promotions") {
        return { update: mockUpdate };
      }
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    });

    await expect(
      enforceAction({
        ownerId: "nonexistent-seller",
        action: "unban",
        reason: "Reversal",
        moderatorId: "mod-1",
      })
    ).rejects.toThrow("Account profile not found for unban");
  });

  it("throws when account profile update fails", async () => {
    // Override the mock for this test to return an error
    mockFrom.mockImplementationOnce(() => ({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          error: { message: "RLS error" },
        }),
      }),
    }));

    await expect(
      enforceAction({
        ownerId: "seller-4",
        action: "ban",
        reason: "Test",
        moderatorId: "mod-1",
      })
    ).rejects.toThrow("Failed to update account status");
  });
});
