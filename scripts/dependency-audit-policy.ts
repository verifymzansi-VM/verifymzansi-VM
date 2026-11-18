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

/**
 * The reviewed exceptions in osv-scanner.toml, shared by the OSV scan and the
 * deploy audit: each needs an advisory id, a written reason and an expiry
 * (`ignoreUntil`). A malformed entry throws, so the audit fails closed.
 */
export function readAuditExceptions(
  tomlText: string,
  parse: (text: string) => unknown
): { id: string; until: Date; reason: string }[] {
  const data = parse(tomlText) as { IgnoredVulns?: unknown };
  if (data.IgnoredVulns === undefined) return [];
  if (!Array.isArray(data.IgnoredVulns)) throw new Error("IgnoredVulns must be a list");
  return data.IgnoredVulns.map((entry: unknown) => {
    const row = entry as { id?: unknown; ignoreUntil?: unknown; reason?: unknown };
    const until = row.ignoreUntil instanceof Date ? new Date(row.ignoreUntil.getTime()) : null;
    if (
      typeof row.id !== "string" ||
      !/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/.test(row.id) ||
      typeof row.reason !== "string" ||
      row.reason.trim().length < 40 ||
      !until ||
      Number.isNaN(until.getTime())
    )
      throw new Error(`Invalid reviewed exception: ${String(row.id)}`);
    return { id: row.id, until, reason: row.reason };
  });
}
