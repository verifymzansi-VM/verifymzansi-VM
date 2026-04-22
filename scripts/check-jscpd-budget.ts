import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type JscpdTotal = {
  clones: number;
  duplicatedLines: number;
  percentage: number;
};

type JscpdSourceStats = {
  clones: number;
  duplicatedLines: number;
  percentage: number;
};

type JscpdFormatStats = {
  sources?: Record<string, JscpdSourceStats>;
};

type JscpdReport = {
  statistics?: {
    total?: JscpdTotal;
    formats?: Record<string, JscpdFormatStats>;
  };
};

type Offender = {
  filePath: string;
  clones: number;
  duplicatedLines: number;
  percentage: number;
};

const root = process.cwd();
const rootNormalized = root.replace(/\\/g, "/");
const reportPath = resolve(root, "tmp", "jscpd", "jscpd-report.json");

const maxClones = Number(process.env.JSCPD_BUDGET_MAX_CLONES ?? "55");
const maxDuplicatedLines = Number(process.env.JSCPD_BUDGET_MAX_DUPLICATED_LINES ?? "1012");
const maxPercentage = Number(process.env.JSCPD_BUDGET_MAX_PERCENT ?? "0.96");

function fail(message: string): never {
  console.error(`::error::${message}`);
  process.exit(1);
}

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function normalizePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith(`${rootNormalized}/`)) {
    return normalized.slice(rootNormalized.length + 1);
  }
  return normalized;
}

function collectTopOffenders(report: JscpdReport): Offender[] {
  const formats = Object.values(report.statistics?.formats ?? {});
  const offenders: Offender[] = [];

  for (const format of formats) {
    for (const [filePath, stats] of Object.entries(format.sources ?? {})) {
      if (stats.duplicatedLines <= 0) {
        continue;
      }

      offenders.push({
        filePath: normalizePath(filePath),
        clones: stats.clones,
        duplicatedLines: stats.duplicatedLines,
        percentage: stats.percentage,
      });
    }
  }

  return offenders.sort(
    (left, right) =>
      right.duplicatedLines - left.duplicatedLines ||
      right.clones - left.clones ||
      right.percentage - left.percentage
  );
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function main(): void {
  if (!Number.isFinite(maxClones) || maxClones < 0) {
    fail("Invalid JSCPD_BUDGET_MAX_CLONES value. Expected a non-negative number.");
  }

  if (!Number.isFinite(maxDuplicatedLines) || maxDuplicatedLines < 0) {
    fail("Invalid JSCPD_BUDGET_MAX_DUPLICATED_LINES value. Expected a non-negative number.");
  }

  if (!Number.isFinite(maxPercentage) || maxPercentage < 0) {
    fail("Invalid JSCPD_BUDGET_MAX_PERCENT value. Expected a non-negative number.");
  }

  const report = readJson<JscpdReport>(reportPath);
  if (!report?.statistics?.total) {
    fail(
      "Cannot read tmp/jscpd/jscpd-report.json. Run pnpm jscpd before checking the duplication budget."
    );
  }

  const total = report.statistics.total;
  const offenders = collectTopOffenders(report);
  const topOffenders = offenders
    .slice(0, 8)
    .map(
      (entry) =>
        `${entry.filePath}=${entry.duplicatedLines} lines (${entry.clones} clones, ${formatPercent(entry.percentage)})`
    )
    .join(", ");

  console.warn(
    `JSCPD budget (clones / duplicated lines / duplicated %): ${maxClones} / ${maxDuplicatedLines} / ${formatPercent(maxPercentage)}`
  );
  console.warn(
    `Current total (clones / duplicated lines / duplicated %): ${total.clones} / ${total.duplicatedLines} / ${formatPercent(total.percentage)}`
  );

  const breaches: string[] = [];
  if (total.clones > maxClones) {
    breaches.push(`clones ${total.clones} > ${maxClones}`);
  }
  if (total.duplicatedLines > maxDuplicatedLines) {
    breaches.push(`duplicated lines ${total.duplicatedLines} > ${maxDuplicatedLines}`);
  }
  if (total.percentage > maxPercentage) {
    breaches.push(
      `duplicated percentage ${formatPercent(total.percentage)} > ${formatPercent(maxPercentage)}`
    );
  }

  if (breaches.length > 0) {
    fail(
      `JSCPD duplication budget exceeded: ${breaches.join("; ")}. Top offenders: ${topOffenders}.`
    );
  }

  if (topOffenders) {
    console.warn(`Top duplicated files: ${topOffenders}`);
  }
}

main();
