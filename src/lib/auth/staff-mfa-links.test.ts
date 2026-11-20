import { describe, expect, it } from "vitest";
import { staffReturnPath, staffVerifyHref } from "./staff-mfa-links";

describe("staffVerifyHref", () => {
  it("adds the return path to a bare or query-carrying verify URL", () => {
    expect(staffVerifyHref("/staff/two-step", "/admin/governance/roles")).toBe(
      "/staff/two-step?next=%2Fadmin%2Fgovernance%2Froles"
    );
    expect(staffVerifyHref("/staff/two-step?confirm=1", "/admin")).toBe(
      "/staff/two-step?confirm=1&next=%2Fadmin"
    );
  });
});

describe("staffReturnPath", () => {
  it("returns to a back-office page", () => {
    expect(staffReturnPath("/admin/dsar?view=open")).toBe("/admin/dsar?view=open");
    expect(staffReturnPath("/admin")).toBe("/admin");
  });

  it.each([
    [undefined],
    [["/admin/a", "/admin/b"]],
    [["/admin/a"]],
    ["/dashboard"],
    ["//example.com/admin"],
    ["https://example.com/admin"],
    ["/administrator"],
  ])("falls back to the staff home for %j", (value) => {
    expect(staffReturnPath(value)).toBe("/admin");
  });
});
