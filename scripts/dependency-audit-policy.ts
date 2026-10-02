// pnpm can return a nonzero status for lower-severity findings in JSON mode.
// Only accept a complete report; network errors and malformed reports fail closed.
export function dependencyAuditVerdict(
  status: number | null,
  report: unknown
): "PASS" | "FAIL" | "INVALID" {
  if ((status !== 0 && status !== 1) || !report || typeof report !== "object") return "INVALID";
  const data = report as {
    error?: unknown;
    metadata?: { vulnerabilities?: { high?: unknown; critical?: unknown } };
  };
  if (data.error) return "INVALID";
  const counts = data.metadata?.vulnerabilities;
  const high = counts?.high;
  const critical = counts?.critical;
  if (
    typeof high !== "number" ||
    !Number.isInteger(high) ||
    high < 0 ||
    typeof critical !== "number" ||
    !Number.isInteger(critical) ||
    critical < 0
  )
    return "INVALID";
  return high + critical === 0 ? "PASS" : "FAIL";
}
