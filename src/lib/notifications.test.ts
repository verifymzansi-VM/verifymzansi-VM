import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateAdminClient, mockFrom, mockInsert, mockListUsers, mockLogger } = vi.hoisted(
  () => ({
    mockCreateAdminClient: vi.fn(),
    mockFrom: vi.fn(),
    mockInsert: vi.fn(),
    mockListUsers: vi.fn(),
    mockLogger: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    },
  })
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => mockLogger,
}));

import { createNotification, createNotifications, notifyStaffForAdminEvent } from "./notifications";

describe("notifications helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateAdminClient.mockReturnValue({
      from: mockFrom,
      auth: {
        admin: {
          listUsers: mockListUsers,
        },
      },
    });
    mockFrom.mockReturnValue({
      insert: mockInsert,
    });
    mockInsert.mockResolvedValue({ error: null });
    mockListUsers.mockResolvedValue({ data: { users: [] }, error: null });
  });

  it("uses the admin client and normalizes nullable fields for single inserts", async () => {
    const ok = await createNotification({
      userId: "seller-1",
      type: "success",
      title: "Approved",
    });

    expect(ok).toBe(true);
    expect(mockCreateAdminClient).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith("notifications");
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: "seller-1",
      type: "success",
      title: "Approved",
      message: null,
      href: null,
    });
  });

  it("normalizes nullable fields for bulk inserts", async () => {
    const ok = await createNotifications([
      {
        userId: "seller-1",
        type: "info",
        title: "Lead",
      },
      {
        userId: "seller-2",
        type: "warning",
        title: "Review",
        message: "Needs changes",
        href: "/dashboard/review",
      },
    ]);

    expect(ok).toBe(true);
    expect(mockCreateAdminClient).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith([
      {
        user_id: "seller-1",
        type: "info",
        title: "Lead",
        message: null,
        href: null,
      },
      {
        user_id: "seller-2",
        type: "warning",
        title: "Review",
        message: "Needs changes",
        href: "/dashboard/review",
      },
    ]);
  });

  it("returns false when the insert reports an error", async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: "insert failed" } });

    await expect(
      createNotification({
        userId: "seller-1",
        type: "error",
        title: "Failed",
      })
    ).resolves.toBe(false);

    expect(mockLogger.error).toHaveBeenCalledWith("createNotification failed", {
      error: "insert failed",
    });
  });

  it("returns false when the admin client throws", async () => {
    mockCreateAdminClient.mockImplementationOnce(() => {
      throw new Error("missing credentials");
    });

    await expect(
      createNotifications([
        {
          userId: "seller-1",
          type: "info",
          title: "Lead",
        },
      ])
    ).resolves.toBe(false);

    expect(mockLogger.error).toHaveBeenCalledWith("createNotifications unexpected error", {
      error: "Error: missing credentials",
    });
  });

  function staffRolesReturn(result: { data: unknown; error: unknown }) {
    const eq = vi.fn().mockResolvedValue(result);
    mockFrom.mockImplementation((table: string) =>
      table === "staff_roles" ? { select: vi.fn(() => ({ eq })) } : { insert: mockInsert }
    );
    return eq;
  }

  it("sends bulk staff notifications only to active staff with the requested capability", async () => {
    const eq = staffRolesReturn({
      data: [
        { user_id: "moderator-1", role: "moderator" },
        { user_id: "governance-1", role: "governance_controller" },
        { user_id: "admin-1", role: "admin" },
      ],
      error: null,
    });

    const ok = await notifyStaffForAdminEvent({
      capability: "dsar:manage",
      title: "New DSAR request",
      message: "A new data request is ready for review.",
      href: "/admin/dsar",
      excludeUserId: "admin-1",
    });

    expect(ok).toBe(true);
    expect(eq).toHaveBeenCalledWith("status", "active");
    expect(mockListUsers).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledWith([
      {
        user_id: "governance-1",
        type: "warning",
        title: "New DSAR request",
        message: "A new data request is ready for review.",
        href: "/admin/dsar",
      },
    ]);
  });

  it("returns false when listing staff recipients fails", async () => {
    staffRolesReturn({ data: null, error: { message: "staff lookup failed" } });

    await expect(
      notifyStaffForAdminEvent({
        capability: "queue:view",
        title: "New queue item",
        href: "/admin/moderation",
      })
    ).resolves.toBe(false);

    expect(mockLogger.error).toHaveBeenCalledWith("notifyStaffForAdminEvent failed", {
      error: "staff lookup failed",
      capability: "queue:view",
    });
  });
});
