import { describe, expect, it } from "vitest";
import {
  foundationSessionDisplayName,
  foundationSessionRole,
  foundationShowsAdminLink,
  isStaffRole,
  readSessionDisplayName,
} from "./session-display";

describe("readSessionDisplayName", () => {
  it("reads the name Google sign-in provides", () => {
    expect(
      readSessionDisplayName(
        { full_name: "Thando Dlamini", name: "Thando Dlamini" },
        "thando@gmail.com"
      )
    ).toBe("Thando Dlamini");
    expect(readSessionDisplayName({ name: "Thando Dlamini" }, "t@gmail.com")).toBe(
      "Thando Dlamini"
    );
    expect(
      readSessionDisplayName({ given_name: "Thando", family_name: "Dlamini" }, "t@gmail.com")
    ).toBe("Thando Dlamini");
  });

  it("prefers display_name and falls back to the address", () => {
    expect(readSessionDisplayName({ display_name: "Sipho", full_name: "X Y" }, "a@b.co")).toBe(
      "Sipho"
    );
    expect(readSessionDisplayName({}, "jane@example.com")).toBe("jane");
    expect(readSessionDisplayName(null, undefined)).toBe("User");
  });
});

describe("foundationSessionDisplayName", () => {
  const google = { full_name: "Thando Dlamini" };

  it("uses the saved profile name when there is one", () => {
    expect(foundationSessionDisplayName("Sipho M.", google, "t@gmail.com")).toBe("Sipho M.");
  });

  it("uses the Google name before a name is saved, never an empty name", () => {
    expect(foundationSessionDisplayName("", google, "t@gmail.com")).toBe("Thando Dlamini");
    expect(foundationSessionDisplayName(null, google, "t@gmail.com")).toBe("Thando Dlamini");
    expect(foundationSessionDisplayName("  ", {}, "jane@example.com")).toBe("jane");
  });
});

describe("foundationSessionRole", () => {
  const staff = (role: "moderator" | "governor" | "admin", can_access: boolean) => ({
    role,
    can_access,
    assigned_capabilities: [],
  });

  it("keeps the staff role before this session's two-step check", () => {
    expect(foundationSessionRole(staff("admin", false))).toBe("admin");
    expect(foundationSessionRole(staff("admin", true))).toBe("admin");
    expect(foundationSessionRole(staff("moderator", false))).toBe("moderator");
    expect(foundationSessionRole(staff("governor", false))).toBe("governance_controller");
  });

  it("is an ordinary user without a staff role", () => {
    expect(foundationSessionRole(null)).toBe("user");
  });
});

describe("isStaffRole", () => {
  it("covers every staff role and nothing else", () => {
    expect(isStaffRole("admin")).toBe(true);
    expect(isStaffRole("moderator")).toBe(true);
    expect(isStaffRole("governance_controller")).toBe(true);
    expect(isStaffRole("user")).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
});

describe("foundationShowsAdminLink", () => {
  const admin = { role: "admin" as const, can_access: false, assigned_capabilities: [] };

  it("hides the link for an invited administrator who has no authenticator app yet", () => {
    expect(foundationShowsAdminLink({ staff: admin, totp_enrolled: false })).toBe(false);
  });

  it("shows the link to enrolled staff whose two-step check has lapsed", () => {
    expect(foundationShowsAdminLink({ staff: admin, totp_enrolled: true })).toBe(true);
  });

  it("shows the link to staff with a current two-step check", () => {
    expect(
      foundationShowsAdminLink({ staff: { ...admin, can_access: true }, totp_enrolled: true })
    ).toBe(true);
  });

  it("hides the link from members, enrolled or not", () => {
    expect(foundationShowsAdminLink({ staff: null, totp_enrolled: true })).toBe(false);
    expect(foundationShowsAdminLink({ staff: null, totp_enrolled: false })).toBe(false);
  });
});
