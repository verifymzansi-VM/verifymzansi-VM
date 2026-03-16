import { describe, it, expect } from "vitest";
import { getRoleFromUser, isAdmin, isModeratorOrAdmin, asAdminRole, requireRole } from "./roles";

function makeUser(role: unknown, isAnon = false) {
  return { app_metadata: { role }, is_anonymous: isAnon };
}

describe("getRoleFromUser", () => {
  it("returns null for null/undefined user", () => {
    expect(getRoleFromUser(null)).toBeNull();
    expect(getRoleFromUser(undefined)).toBeNull();
  });

  it("returns null for anonymous user", () => {
    expect(getRoleFromUser(makeUser("admin", true))).toBeNull();
  });

  it("returns null when app_metadata has no role key", () => {
    expect(getRoleFromUser({ app_metadata: {}, is_anonymous: false })).toBeNull();
  });

  it("returns null when role is not a string", () => {
    expect(getRoleFromUser(makeUser(123))).toBeNull();
  });

  it("returns null when role is empty/whitespace", () => {
    expect(getRoleFromUser(makeUser("  "))).toBeNull();
  });

  it("normalizes known roles", () => {
    expect(getRoleFromUser(makeUser("Admin"))).toBe("admin");
    expect(getRoleFromUser(makeUser("MODERATOR"))).toBe("moderator");
    expect(getRoleFromUser(makeUser("member"))).toBe("member");
  });

  it("returns raw lowercased role for unknown roles", () => {
    expect(getRoleFromUser(makeUser("editor"))).toBe("editor");
  });
});

describe("isAdmin", () => {
  it("true for admin", () => expect(isAdmin(makeUser("admin"))).toBe(true));
  it("false for non-admin", () => expect(isAdmin(makeUser("member"))).toBe(false));
  it("false for null user", () => expect(isAdmin(null)).toBe(false));
});

describe("isModeratorOrAdmin", () => {
  it("true for admin", () => expect(isModeratorOrAdmin(makeUser("admin"))).toBe(true));
  it("true for moderator", () => expect(isModeratorOrAdmin(makeUser("moderator"))).toBe(true));
  it("false for member", () => expect(isModeratorOrAdmin(makeUser("member"))).toBe(false));
});

describe("asAdminRole", () => {
  it("returns 'admin' for admin", () => expect(asAdminRole("admin")).toBe("admin"));
  it("returns 'moderator' for moderator", () => expect(asAdminRole("moderator")).toBe("moderator"));
  it("returns null for other roles", () => expect(asAdminRole("member")).toBeNull());
  it("returns null for null", () => expect(asAdminRole(null)).toBeNull());
});

describe("requireRole", () => {
  it("true when role is in allowed list", () => {
    expect(requireRole(makeUser("admin"), ["admin", "moderator"])).toBe(true);
  });
  it("false when role is not in allowed list", () => {
    expect(requireRole(makeUser("member"), ["admin"])).toBe(false);
  });
  it("false for null user", () => {
    expect(requireRole(null, ["admin"])).toBe(false);
  });
});
