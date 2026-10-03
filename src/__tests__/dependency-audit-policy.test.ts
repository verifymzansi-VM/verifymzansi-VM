import { describe, expect, it } from "vitest";
import { dependencyAuditVerdict } from "../../scripts/dependency-audit-policy";

describe("dependency audit gate", () => {
  it("blocks lower-severity security findings even when high/critical are zero", () => {
    expect(
      dependencyAuditVerdict(1, {
        metadata: { vulnerabilities: { info: 0, high: 0, critical: 0, moderate: 6, low: 1 } },
      })
    ).toBe("FAIL");
  });
  it.each([
    { high: 1, critical: 0 },
    { high: 0, critical: 1 },
  ])("blocks high or critical findings: %j", (vulnerabilities) => {
    expect(
      dependencyAuditVerdict(0, {
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, ...vulnerabilities } },
      })
    ).toBe("FAIL");
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
