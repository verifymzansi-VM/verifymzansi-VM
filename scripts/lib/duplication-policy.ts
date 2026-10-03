import { createHash } from "node:crypto";
import path from "node:path";
type Duplicate = {
  fragment: string;
  firstFile: { name: string };
  secondFile: { name: string };
  lines: number;
  tokens: number;
};
type Report = {
  statistics: {
    total: Record<string, number>;
    formats: Record<string, { sources: Record<string, unknown> }>;
  };
  duplicates: Duplicate[];
};
export type DuplicationBaseline = {
  schemaVersion: number;
  roots: string[];
  total: { clones: number; duplicatedLines: number; percentage: number };
  fingerprints: string[];
};
function relative(file: string, root: string) {
  return path.relative(root, file).replace(/\\/g, "/");
}
export function fingerprints(report: Report, root: string): string[] {
  return report.duplicates
    .map((dup) =>
      createHash("sha256")
        .update(
          JSON.stringify([
            ...[relative(dup.firstFile.name, root), relative(dup.secondFile.name, root)].sort(),
            dup.fragment.replace(/\r\n/g, "\n").trim(),
          ])
        )
        .digest("base64url")
    )
    .sort();
}
export function validateDuplication(
  report: unknown,
  baseline: DuplicationBaseline,
  modifiedAt: number,
  startedAt: number,
  root: string
): string[] {
  if (modifiedAt < startedAt || modifiedAt > Date.now() + 1000)
    throw new Error("Stale duplication report");
  const value = report as Report;
  if (!value?.statistics?.total || !value.statistics.formats || !Array.isArray(value.duplicates))
    throw new Error("Invalid duplication report structure");
  for (const key of ["sources", "lines", "tokens", "clones", "duplicatedLines", "percentage"]) {
    const n = value.statistics.total[key];
    if (
      typeof n !== "number" ||
      !Number.isFinite(n) ||
      n < 0 ||
      (key !== "percentage" && !Number.isInteger(n))
    )
      throw new Error(`Invalid duplication total ${key}`);
  }
  if (
    value.statistics.total.percentage > 100 ||
    value.statistics.total.sources === 0 ||
    value.statistics.total.lines === 0 ||
    value.statistics.total.tokens === 0
  )
    throw new Error("Empty/invalid scan coverage");
  if (
    !baseline ||
    baseline.schemaVersion !== 1 ||
    !Array.isArray(baseline.fingerprints) ||
    !baseline.roots?.length
  )
    throw new Error("Invalid duplication baseline");
  for (const dup of value.duplicates) {
    if (
      typeof dup.fragment !== "string" ||
      !dup.fragment ||
      !dup.firstFile?.name ||
      !dup.secondFile?.name ||
      !Number.isInteger(dup.lines) ||
      dup.lines < 1
    )
      throw new Error("Invalid duplicate entry");
  }
  if (value.duplicates.length !== value.statistics.total.clones)
    throw new Error("Clone totals disagree");
  const sources = Object.values(value.statistics.formats)
    .flatMap((format) => Object.keys(format.sources || {}))
    .map((file) => relative(file, root));
  if (sources.length !== value.statistics.total.sources) throw new Error("Source totals disagree");
  for (const scanRoot of baseline.roots)
    if (!sources.some((file) => file.startsWith(`${scanRoot}/`)))
      throw new Error(`Missing scan root: ${scanRoot}`);
  const errors: string[] = [];
  for (const key of ["clones", "duplicatedLines", "percentage"] as const) {
    if (!Number.isFinite(baseline.total[key]) || baseline.total[key] < 0)
      throw new Error("Invalid baseline budget");
    if (value.statistics.total[key] > baseline.total[key])
      errors.push(
        `${key} exceeds reviewed baseline: ${value.statistics.total[key]} > ${baseline.total[key]}`
      );
  }
  const approved = new Set(baseline.fingerprints);
  const added = fingerprints(value, root).filter((id) => !approved.has(id));
  if (added.length)
    errors.push(
      `${added.length} new/changed duplicate fragments require correction or explicit debt review`
    );
  return errors;
}
