import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc }),
}));

import {
  getAdminActorRole,
  getGovernanceActorRole,
  getStaffActorRole,
  readStaffAccessFromDb,
  roleHasCapability,
  verifyAdminActorRoleFromDb,
  verifyCapabilityFromDb,
  verifyCapabilityRoleFromDb,
  verifyGovernanceActorRoleFromDb,
  verifyStaffActorRoleFromDb,
} from "./admin-access";

const GRACE_END = "2026-10-04T10:00:00.000Z";

function dbReturns(role: string | null) {
  mockRpc.mockResolvedValue({
    data: role ? [{ role, mfa_required_after: GRACE_END }] : [],
    error: null,
  });
}

/** A user whose token still claims `jwtRole`, whatever the database says. */
const user = (jwtRole = "member") => ({
  id: "user-1",
  app_metadata: { role: jwtRole },
  is_anonymous: false,
});

describe("admin access helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads JWT role hints without authorising from them", () => {
    expect(getStaffActorRole(user("moderator"))).toBe("moderator");
    expect(getAdminActorRole(user("admin"))).toBe("admin");
    expect(getGovernanceActorRole(user("governance_controller"))).toBe("governance_controller");
  });

  it("reads role and MFA deadline from staff_access_of", async () => {
    dbReturns("governance_controller");

    await expect(readStaffAccessFromDb("user-1")).resolves.toEqual({
      role: "governance_controller",
      mfaRequiredAfter: new Date(GRACE_END),
    });
    expect(mockRpc).toHaveBeenCalledWith("staff_access_of", { p_user: "user-1" });
  });

  it("ignores a staff role claimed only by the JWT", async () => {
    dbReturns(null);
    await expect(verifyStaffActorRoleFromDb(user("admin"))).resolves.toBeNull();
    await expect(verifyCapabilityFromDb(user("admin"), "role:assign")).resolves.toBe(false);
  });

  it("uses the database role even when the JWT is stale", async () => {
    dbReturns("admin");
    await expect(verifyAdminActorRoleFromDb(user("member"))).resolves.toBe("admin");

    dbReturns("moderator");
    await expect(verifyCapabilityRoleFromDb(user("admin"), "decision:approve")).resolves.toBeNull();
    await expect(verifyCapabilityRoleFromDb(user("admin"), "queue:claim")).resolves.toBe(
      "moderator"
    );
  });

  it("narrows governance and admin roles", async () => {
    dbReturns("governance_controller");
    await expect(verifyGovernanceActorRoleFromDb(user())).resolves.toBe("governance_controller");
    await expect(verifyAdminActorRoleFromDb(user())).resolves.toBeNull();
  });

  it.each([
    ["an RPC error", () => mockRpc.mockResolvedValue({ data: null, error: { message: "down" } })],
    ["a thrown error", () => mockRpc.mockRejectedValue(new Error("network"))],
    ["an unknown role", () => dbReturns("superuser")],
    [
      "a malformed deadline",
      () =>
        mockRpc.mockResolvedValue({
          data: [{ role: "admin", mfa_required_after: "not a date" }],
          error: null,
        }),
    ],
  ])("fails closed on %s", async (_label, arrange) => {
    arrange();
    await expect(readStaffAccessFromDb("user-1")).resolves.toBeNull();
  });

  it("skips the database for missing and anonymous users", async () => {
    await expect(verifyStaffActorRoleFromDb(null)).resolves.toBeNull();
    await expect(
      verifyStaffActorRoleFromDb({ ...user("admin"), is_anonymous: true })
    ).resolves.toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("maps roles to capabilities", () => {
    expect(roleHasCapability("governance_controller", "role:review")).toBe(true);
    expect(roleHasCapability("governance_controller", "role:assign")).toBe(false);
    expect(roleHasCapability("moderator", "role:review")).toBe(false);
    expect(roleHasCapability("admin", "payments:refund")).toBe(true);
  });
});
