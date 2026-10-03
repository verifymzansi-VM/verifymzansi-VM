// Every reported security finding blocks; network/malformed reports fail closed.
export function dependencyAuditVerdict(
  status: number | null,
  report: unknown
): "PASS" | "FAIL" | "INVALID" {
  if ((status !== 0 && status !== 1) || !report || typeof report !== "object") return "INVALID";
  const data = report as {
    error?: unknown;
    metadata?: { vulnerabilities?: Record<string, unknown> };
  };
  if (data.error) return "INVALID";
  const counts = data.metadata?.vulnerabilities;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return "INVALID";
  for (const key of ["info", "low", "moderate", "high", "critical"]) {
    if (!Number.isSafeInteger(counts[key]) || Number(counts[key]) < 0) return "INVALID";
  }
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
  for (const value of Object.values(counts || {})) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return "INVALID";
  }
  return Object.values(counts || {}).some((value) => Number(value) > 0) ? "FAIL" : "PASS";
}
