import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateAdminClient, mockGetUserById } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockGetUserById: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

describe("admin access helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({
      auth: {
        admin: {
          getUserById: mockGetUserById,
        },
      },
    });
  });

  it("returns staff roles from JWT metadata", async () => {
    const { getStaffActorRole, getAdminActorRole, getGovernanceActorRole } =
      await import("./admin-access");

    expect(getStaffActorRole({ app_metadata: { role: "moderator" }, is_anonymous: false })).toBe(
      "moderator"
    );
    expect(getAdminActorRole({ app_metadata: { role: "admin" }, is_anonymous: false })).toBe(
      "admin"
    );
    expect(
      getGovernanceActorRole({
        app_metadata: { role: "governance_controller" },
        is_anonymous: false,
      })
    ).toBe("governance_controller");
  });

  it("returns null when the JWT does not contain a staff role", async () => {
    const { verifyStaffActorRoleFromDb } = await import("./admin-access");

    await expect(
      verifyStaffActorRoleFromDb({
        id: "user-1",
        app_metadata: { role: "member" },
        is_anonymous: false,
      } as never)
    ).resolves.toBeNull();

    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  it("returns null when DB re-verification fails", async () => {
    mockGetUserById.mockResolvedValue({ data: { user: null }, error: { message: "not found" } });
    const { verifyStaffActorRoleFromDb } = await import("./admin-access");

    await expect(
      verifyStaffActorRoleFromDb({
        id: "user-1",
        app_metadata: { role: "moderator" },
        is_anonymous: false,
      } as never)
    ).resolves.toBeNull();
  });

  it("narrows verified admin roles correctly", async () => {
    mockGetUserById.mockResolvedValue({
      data: { user: { app_metadata: { role: "admin" }, is_anonymous: false } },
      error: null,
    });
    const { verifyAdminActorRoleFromDb, verifyGovernanceActorRoleFromDb } =
      await import("./admin-access");

    await expect(
      verifyAdminActorRoleFromDb({
        id: "user-1",
        app_metadata: { role: "admin" },
        is_anonymous: false,
      } as never)
    ).resolves.toBe("admin");
    await expect(
      verifyGovernanceActorRoleFromDb({
        id: "user-1",
        app_metadata: { role: "admin" },
        is_anonymous: false,
      } as never)
    ).resolves.toBeNull();
  });

  it("rejects capability checks early when JWT lacks the capability", async () => {
    const { verifyCapabilityFromDb } = await import("./admin-access");

    await expect(
      verifyCapabilityFromDb(
        {
          id: "user-1",
          app_metadata: { role: "moderator" },
          is_anonymous: false,
        } as never,
        "bi:view"
      )
    ).resolves.toBe(false);

    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  it("accepts capability checks only when DB role still grants them", async () => {
    mockGetUserById.mockResolvedValue({
      data: { user: { app_metadata: { role: "governance_controller" }, is_anonymous: false } },
      error: null,
    });
    const { verifyCapabilityFromDb } = await import("./admin-access");

    await expect(
      verifyCapabilityFromDb(
        {
          id: "user-1",
          app_metadata: { role: "governance_controller" },
          is_anonymous: false,
        } as never,
        "decision:approve"
      )
    ).resolves.toBe(true);
  });

  it("rejects capability checks when the DB role has changed", async () => {
    mockGetUserById.mockResolvedValue({
      data: { user: { app_metadata: { role: "moderator" }, is_anonymous: false } },
      error: null,
    });
    const { verifyCapabilityFromDb } = await import("./admin-access");

    await expect(
      verifyCapabilityFromDb(
        {
          id: "user-1",
          app_metadata: { role: "governance_controller" },
          is_anonymous: false,
        } as never,
        "decision:approve"
      )
    ).resolves.toBe(false);
  });
});
