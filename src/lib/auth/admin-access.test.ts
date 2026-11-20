import { beforeEach, describe, expect, it, vi } from "vitest";

const { readFoundationAccountContext } = vi.hoisted(() => ({
  readFoundationAccountContext: vi.fn(),
}));
vi.mock("@/lib/foundation/account-context", () => ({ readFoundationAccountContext }));

import {
  getAdminActorRole,
  getGovernanceActorRole,
  getStaffActorRole,
  readStaffAccessFromDb,
  roleHasCapability,
  staffRoleMeeting,
  verifyAdminActorRoleFromDb,
  verifyCapabilityFromDb,
  verifyCapabilityRoleFromDb,
  verifyGovernanceActorRoleFromDb,
  verifyStaffActorRoleFromDb,
} from "./admin-access";

const api = {} as never;
const MODERATOR = ["queue:claim", "queue:view"];
const GOVERNOR = ["decision:approve", "queue:view", "role:review"];
const ADMIN = ["organisation:manage", "queue:view", "role:manage"];

function dbReturns(
  staff: { role: string; can_access?: boolean; assigned_capabilities: string[] } | null,
  totpEnrolled = true
) {
  readFoundationAccountContext.mockResolvedValue({
    totp_enrolled: totpEnrolled,
    staff: staff && { can_access: true, ...staff },
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

  it("reads role, capabilities and the live staff check from the caller's account context", async () => {
    dbReturns({ role: "governor", can_access: false, assigned_capabilities: GOVERNOR }, false);

    await expect(readStaffAccessFromDb(api)).resolves.toEqual({
      role: "governance_controller",
      capabilities: GOVERNOR,
      canAccess: false,
      totpEnrolled: false,
    });
    expect(readFoundationAccountContext).toHaveBeenCalledExactlyOnceWith(api);
  });

  it("ignores members and an owner invitation that carries no capabilities", async () => {
    dbReturns(null);
    await expect(verifyStaffActorRoleFromDb(api)).resolves.toBeNull();
    dbReturns({ role: "admin", can_access: false, assigned_capabilities: [] });
    await expect(readStaffAccessFromDb(api)).resolves.toBeNull();
    await expect(verifyAdminActorRoleFromDb(api)).resolves.toBeNull();
    await expect(verifyCapabilityFromDb(api, "role:assign")).resolves.toBe(false);
  });

  it("checks capabilities against the database's assignment", async () => {
    dbReturns({ role: "moderator", assigned_capabilities: MODERATOR });
    await expect(verifyCapabilityRoleFromDb(api, "decision:approve")).resolves.toBeNull();
    await expect(verifyCapabilityRoleFromDb(api, "queue:claim")).resolves.toBe("moderator");

    // Presentation aliases map to the canonical capability.
    dbReturns({ role: "admin", assigned_capabilities: ADMIN });
    await expect(verifyCapabilityRoleFromDb(api, "organisations:manage")).resolves.toBe("admin");
    await expect(verifyCapabilityFromDb(api, "role:assign")).resolves.toBe(true);
  });

  it("narrows governance and admin roles", async () => {
    dbReturns({ role: "governor", assigned_capabilities: GOVERNOR });
    await expect(verifyGovernanceActorRoleFromDb(api)).resolves.toBe("governance_controller");
    await expect(verifyAdminActorRoleFromDb(api)).resolves.toBeNull();
    dbReturns({ role: "admin", assigned_capabilities: ADMIN });
    await expect(verifyAdminActorRoleFromDb(api)).resolves.toBe("admin");
  });

  it.each([
    [
      "a refused read",
      () => readFoundationAccountContext.mockRejectedValue(new Error("forbidden")),
    ],
    [
      "an unknown role",
      () => dbReturns({ role: "superuser", assigned_capabilities: ["queue:view"] }),
    ],
  ])("fails closed on %s", async (_label, arrange) => {
    arrange();
    await expect(readStaffAccessFromDb(api)).resolves.toBeNull();
    await expect(verifyStaffActorRoleFromDb(api)).resolves.toBeNull();
  });

  it("meets a requirement only with the right role or capability", () => {
    const access = {
      role: "moderator" as const,
      capabilities: MODERATOR,
      canAccess: true,
      totpEnrolled: true,
    };
    expect(staffRoleMeeting(null)).toBeNull();
    expect(staffRoleMeeting(access)).toBe("moderator");
    expect(staffRoleMeeting(access, { adminOnly: true })).toBeNull();
    expect(staffRoleMeeting(access, { capability: "queue:claim" })).toBe("moderator");
    expect(staffRoleMeeting(access, { capability: "role:assign" })).toBeNull();
  });

  it("maps roles to capabilities", () => {
    expect(roleHasCapability("governance_controller", "role:review")).toBe(true);
    expect(roleHasCapability("governance_controller", "role:assign")).toBe(false);
    expect(roleHasCapability("moderator", "role:review")).toBe(false);
    expect(roleHasCapability("admin", "payments:refund")).toBe(true);
  });
});
