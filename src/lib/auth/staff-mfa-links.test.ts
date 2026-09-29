import { describe, expect, it } from "vitest";
import { staffVerifyHref } from "./staff-mfa-links";

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
