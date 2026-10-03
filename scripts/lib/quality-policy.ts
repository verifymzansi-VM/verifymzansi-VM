import { createHash } from "node:crypto";
export type QualityFinding = {
  file: string;
  rule: string;
  message: string;
  security: boolean;
  error: boolean;
  fingerprint: string;
};
export type QualityBaseline = {
  schemaVersion: number;
  findings: Record<string, number>;
  rationale: string;
  commit: string;
};
export function qualityFingerprint(file: string, rule: string, detail: string) {
  return createHash("sha256")
    .update(JSON.stringify([file.replace(/\\/g, "/"), rule, detail]))
    .digest("base64url");
}
export function qualityRegressions(findings: QualityFinding[], baseline: QualityBaseline) {
  if (
    baseline?.schemaVersion !== 1 ||
    !baseline.findings ||
    !baseline.rationale ||
    !baseline.commit
  )
    throw new Error("Invalid quality baseline");
  for (const count of Object.values(baseline.findings))
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid baseline count");
  const seen = new Map<string, number>();
  return findings.filter((finding) => {
    const n = (seen.get(finding.fingerprint) || 0) + 1;
    seen.set(finding.fingerprint, n);
    return finding.security || finding.error || n > (baseline.findings[finding.fingerprint] || 0);
  });
}
