import { describe, expect, it } from "vitest";
import { dependencyAuditVerdict } from "../../scripts/dependency-audit-policy";

describe("dependency audit gate", () => {
  it("accepts lower-severity findings even when pnpm exits nonzero", () => {
    expect(
      dependencyAuditVerdict(1, {
        metadata: { vulnerabilities: { high: 0, critical: 0, moderate: 6, low: 1 } },
      })
    ).toBe("PASS");
  });
  it.each([
    { high: 1, critical: 0 },
    { high: 0, critical: 1 },
  ])("blocks high or critical findings: %j", (vulnerabilities) => {
    expect(dependencyAuditVerdict(0, { metadata: { vulnerabilities } })).toBe("FAIL");
  });
  it.each([
    null,
    {},
    { error: { code: "ENOTFOUND" } },
    { metadata: { vulnerabilities: { high: 0 } } },
    { metadata: { vulnerabilities: { high: -1, critical: 0 } } },
    { metadata: { vulnerabilities: { high: 0, critical: NaN } } },
  ])("rejects incomplete or invalid reports: %j", (report) => {
    expect(dependencyAuditVerdict(0, report)).toBe("INVALID");
  });
  it("rejects an interrupted audit even if output looks complete", () => {
    expect(
      dependencyAuditVerdict(null, { metadata: { vulnerabilities: { high: 0, critical: 0 } } })
    ).toBe("INVALID");
  });
});
