import { describe, expect, it } from "vitest";
import {
  buildWipePlan,
  isAdminUser,
  parseArgs,
  type AuthUserRecord,
} from "../../scripts/reset-launch-data";

function makeUser(
  id: string,
  email: string,
  role: string | null,
  overrides?: Partial<AuthUserRecord>
): AuthUserRecord {
  return {
    id,
    email,
    role,
    created_at: null,
    app_metadata: role ? { role } : {},
    user_metadata: {},
    ...overrides,
  };
}

describe("reset-launch-data script", () => {
  it("detects admins from app metadata", () => {
    expect(isAdminUser(makeUser("admin-1", "admin@example.com", "admin"))).toBe(true);
    expect(isAdminUser(makeUser("member-1", "user@example.com", "member"))).toBe(false);
  });

  it("does not trust user metadata for admin preservation", () => {
    expect(
      isAdminUser(
        makeUser("member-1", "user@example.com", null, {
          user_metadata: { role: "admin" },
        })
      )
    ).toBe(false);
  });

  it("preserves the sole admin automatically", () => {
    const admin = makeUser("admin-1", "admin@example.com", "admin");
    const member = makeUser("user-1", "user@example.com", "member");

    const plan = buildWipePlan([admin, member]);

    expect(plan.preservedAdmins).toEqual([admin]);
    expect(plan.usersToDelete).toEqual([member]);
  });

  it("refuses ambiguous wipes when multiple admins exist", () => {
    const primaryAdmin = makeUser("admin-1", "admin@example.com", "admin");
    const backupAdmin = makeUser("admin-2", "backup@example.com", "admin");

    expect(() => buildWipePlan([primaryAdmin, backupAdmin])).toThrow(
      "Refusing wipe: found 2 admin users"
    );
  });

  it("preserves only the targeted admin email", () => {
    const primaryAdmin = makeUser("admin-1", "admin@example.com", "admin");
    const backupAdmin = makeUser("admin-2", "backup@example.com", "admin");
    const member = makeUser("user-1", "user@example.com", "member");

    const plan = buildWipePlan([primaryAdmin, backupAdmin, member], {
      preserveAdminEmail: "backup@example.com",
    });

    expect(plan.preservedAdmins).toEqual([backupAdmin]);
    expect(plan.usersToDelete).toEqual([primaryAdmin, member]);
  });

  it("refuses preserving a non-admin target", () => {
    const admin = makeUser("admin-1", "admin@example.com", "admin");
    const member = makeUser("user-1", "user@example.com", "member");

    expect(() =>
      buildWipePlan([admin, member], {
        preserveAdminEmail: "user@example.com",
      })
    ).toThrow("is not an admin");
  });

  it("parses preserve-admin arguments", () => {
    expect(
      parseArgs([
        "--execute",
        "--confirm-project=proj_123",
        "--preserve-admin-email=admin@example.com",
      ])
    ).toMatchObject({
      mode: "wipe",
      confirmProject: "proj_123",
      preserveAdminEmail: "admin@example.com",
      preserveAdminUserId: null,
    });
  });
});
