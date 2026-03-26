import { describe, it, expect } from "vitest";
import {
  getRoleFromUser,
  isAdmin,
  isModeratorOrAdmin,
  isStaff,
  isGovernanceController,
  asAdminRole,
  asStaffRole,
  hasCapability,
  hasAnyCapability,
  hasAllCapabilities,
  requireRole,
} from "./roles";

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
    expect(getRoleFromUser(makeUser("governance_controller"))).toBe("governance_controller");
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

describe("isGovernanceController", () => {
  it("true for governance_controller", () =>
    expect(isGovernanceController(makeUser("governance_controller"))).toBe(true));
  it("false for moderator", () =>
    expect(isGovernanceController(makeUser("moderator"))).toBe(false));
  it("false for null user", () => expect(isGovernanceController(null)).toBe(false));
});

describe("isStaff", () => {
  it("true for admin", () => expect(isStaff(makeUser("admin"))).toBe(true));
  it("true for moderator", () => expect(isStaff(makeUser("moderator"))).toBe(true));
  it("true for governance_controller", () =>
    expect(isStaff(makeUser("governance_controller"))).toBe(true));
  it("false for member", () => expect(isStaff(makeUser("member"))).toBe(false));
  it("false for null user", () => expect(isStaff(null)).toBe(false));
});

describe("isModeratorOrAdmin (deprecated, delegates to isStaff)", () => {
  it("true for admin", () => expect(isModeratorOrAdmin(makeUser("admin"))).toBe(true));
  it("true for moderator", () => expect(isModeratorOrAdmin(makeUser("moderator"))).toBe(true));
  it("true for governance_controller", () =>
    expect(isModeratorOrAdmin(makeUser("governance_controller"))).toBe(true));
  it("false for member", () => expect(isModeratorOrAdmin(makeUser("member"))).toBe(false));
});

describe("asStaffRole", () => {
  it("returns 'admin' for admin", () => expect(asStaffRole("admin")).toBe("admin"));
  it("returns 'moderator' for moderator", () => expect(asStaffRole("moderator")).toBe("moderator"));
  it("returns 'governance_controller' for gc", () =>
    expect(asStaffRole("governance_controller")).toBe("governance_controller"));
  it("returns null for member", () => expect(asStaffRole("member")).toBeNull());
  it("returns null for null", () => expect(asStaffRole(null)).toBeNull());
});

describe("asAdminRole (deprecated)", () => {
  it("returns 'admin' for admin", () => expect(asAdminRole("admin")).toBe("admin"));
  it("returns 'moderator' for moderator", () => expect(asAdminRole("moderator")).toBe("moderator"));
  it("returns null for other roles", () => expect(asAdminRole("member")).toBeNull());
  it("returns null for null", () => expect(asAdminRole(null)).toBeNull());
});

describe("hasCapability", () => {
  it("moderator can view queues", () => {
    expect(hasCapability(makeUser("moderator"), "queue:view")).toBe(true);
  });
  it("moderator can recommend cases", () => {
    expect(hasCapability(makeUser("moderator"), "case:recommend")).toBe(true);
  });
  it("moderator cannot approve decisions", () => {
    expect(hasCapability(makeUser("moderator"), "decision:approve")).toBe(false);
  });
  it("governance_controller can approve decisions", () => {
    expect(hasCapability(makeUser("governance_controller"), "decision:approve")).toBe(true);
  });
  it("governance_controller can decide appeals", () => {
    expect(hasCapability(makeUser("governance_controller"), "appeal:decide")).toBe(true);
  });
  it("admin can view BI", () => {
    expect(hasCapability(makeUser("admin"), "bi:view")).toBe(true);
  });
  it("admin can export BI", () => {
    expect(hasCapability(makeUser("admin"), "bi:export")).toBe(true);
  });
  it("member cannot view queues", () => {
    expect(hasCapability(makeUser("member"), "queue:view")).toBe(false);
  });
  it("null user has no capabilities", () => {
    expect(hasCapability(null, "queue:view")).toBe(false);
  });
});

describe("hasAnyCapability", () => {
  it("true if user has at least one of listed capabilities", () => {
    expect(hasAnyCapability(makeUser("moderator"), ["decision:approve", "queue:view"])).toBe(true);
  });
  it("false if user has none of listed capabilities", () => {
    expect(hasAnyCapability(makeUser("member"), ["decision:approve", "queue:view"])).toBe(false);
  });
});

describe("hasAllCapabilities", () => {
  it("true if user has all listed capabilities", () => {
    expect(hasAllCapabilities(makeUser("moderator"), ["queue:view", "case:recommend"])).toBe(true);
  });
  it("false if user is missing any capability", () => {
    expect(hasAllCapabilities(makeUser("moderator"), ["queue:view", "decision:approve"])).toBe(
      false
    );
  });
});

describe("requireRole", () => {
  it("true when role is in allowed list", () => {
    expect(requireRole(makeUser("admin"), ["admin", "moderator"])).toBe(true);
  });
  it("true for governance_controller in allowed list", () => {
    expect(requireRole(makeUser("governance_controller"), ["governance_controller", "admin"])).toBe(
      true
    );
  });
  it("false when role is not in allowed list", () => {
    expect(requireRole(makeUser("member"), ["admin"])).toBe(false);
  });
  it("false for null user", () => {
    expect(requireRole(null, ["admin"])).toBe(false);
  });
});
