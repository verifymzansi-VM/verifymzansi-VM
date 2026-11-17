#!/usr/bin/env node
// Turns the Playwright JSON report of one browser project into a short
// Markdown summary for the CI job page (workflow "E2E foundation", and the
// browser jobs of workflow "CI"). It keeps three endings apart: real test
// failures, a run that ran out of time with no failure recorded, and a run
// that stopped before any report was written (step limit, cancellation or a
// crash). It also counts tests that passed only on retry (flaky), which the
// overall result hides.
//
// Usage: node scripts/e2e-foundation-summary.mjs <report.json> <project> [started-epoch-seconds] [heading]

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ESCAPES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const GLOBAL_TIMEOUT = /Timed out waiting ([\d.]+)s for the .+ to run/;

/** @param {any} suite @param {string[]} titles @param {any[]} out */
function collect(suite, titles, out) {
  const path = suite.title ? [...titles, suite.title] : titles;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      out.push({ titles: [...path, spec.title], line: spec.line, file: spec.file, test });
    }
  }
  for (const child of suite.suites ?? []) collect(child, path, out);
}

/** @param {number} ms */
function minutes(ms) {
  return `${(ms / 60_000).toFixed(1)} min`;
}

/** @param {string} message */
function firstLine(message) {
  const text = message.replace(ESCAPES, "");
  return (text.split("\n").find((line) => line.trim()) ?? "failed").trim().slice(0, 160);
}

/** A test that never finished: no result, or only interrupted/not-run results. */
function didNotRun(test) {
  if (test.status !== "skipped") return false;
  const results = test.results ?? [];
  if (results.length === 0) return true;
  return results.every(
    (result) =>
      result.status === "interrupted" ||
      (result.status === "skipped" && test.expectedStatus !== "skipped")
  );
}

const DEFAULT_HEADING = "Foundation browser tests";

/**
 * @param {any} report Playwright JSON report
 * @param {string} project
 * @param {string} [heading]
 * @returns {string} Markdown
 */
export function summarise(report, project, heading = DEFAULT_HEADING) {
  const rows = [];
  for (const suite of report.suites ?? []) collect(suite, [], rows);
  const failed = rows.filter((row) => row.test.status === "unexpected");
  const flaky = rows.filter((row) => row.test.status === "flaky");
  const notRun = rows.filter((row) => didNotRun(row.test));
  const skipped = rows.filter((row) => row.test.status === "skipped" && !didNotRun(row.test));
  const passed = rows.filter((row) => row.test.status === "expected");
  const markedToFail = passed.filter((row) => row.test.expectedStatus === "failed");
  const duration = Number(report.stats?.duration ?? 0);

  const errors = (report.errors ?? []).map((error) => firstLine(error.message ?? ""));
  const timeout = errors.map((text) => GLOBAL_TIMEOUT.exec(text)).find(Boolean);
  const otherErrors = errors.filter((text) => !GLOBAL_TIMEOUT.test(text));

  const lines = [`## ${heading} (${project})`, ""];
  if (timeout) {
    lines.push(
      failed.length === 0
        ? `**Timed out after ${minutes(Number(timeout[1]) * 1000)} — no test failure recorded.** ${notRun.length} test(s) did not run; rerun the job.`
        : `**Timed out after ${minutes(Number(timeout[1]) * 1000)} with ${failed.length} failed test(s).** ${notRun.length} test(s) did not run.`
    );
  } else if (failed.length > 0) {
    lines.push(`**${failed.length} test(s) failed.**`);
  } else if (otherErrors.length > 0 || rows.length === 0) {
    lines.push(
      `**The run did not complete:** ${otherErrors.length > 0 ? otherErrors.join("; ") : "no test ran"}. See the job log.`
    );
  } else {
    lines.push("All tests passed.");
  }
  lines.push(
    "",
    `${passed.length} passed (${markedToFail.length} of them expected failures marked \`test.fail\`), ` +
      `${failed.length} failed, ${flaky.length} flaky, ${skipped.length} skipped, ` +
      `${notRun.length} did not run. Took ${minutes(duration)}.`
  );
  if (failed.length > 0) {
    lines.push("", "| Test | First error |", "| --- | --- |");
    for (const row of failed) {
      const results = row.test.results ?? [];
      const last = results[results.length - 1];
      const message = last?.errors?.[0]?.message ?? last?.error?.message ?? "";
      const name = row.titles.filter((title) => !title.endsWith(".spec.ts")).join(" › ");
      const where = row.file ? `${row.file}:${row.line}` : "";
      lines.push(
        `| ${`${name} (${where})`.replace(/\|/g, "/")} | ${firstLine(message).replace(/\|/g, "/")} |`
      );
    }
  }
  if (flaky.length > 0) {
    lines.push("", "Passed only on retry:");
    for (const row of flaky) {
      lines.push(`- ${row.titles.filter((title) => !title.endsWith(".spec.ts")).join(" › ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Summary when Playwright wrote no report at all.
 * @param {string} project @param {number | undefined} elapsedMs @param {string} [heading]
 */
export function summariseMissing(project, elapsedMs, heading = DEFAULT_HEADING) {
  const took = elapsedMs === undefined ? "" : ` after ${minutes(elapsedMs)}`;
  return (
    `## ${heading} (${project})\n\n` +
    `**No report: the browser tests stopped${took} before Playwright finished ` +
    "(the step limit was reached, the run was cancelled or it crashed) — no test failure recorded.** " +
    "See the job log.\n"
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [file, project, started, heading] = process.argv.slice(2);
  if (!file || !project) {
    throw new Error(
      "Usage: e2e-foundation-summary.mjs <report.json> <project> [started-epoch-seconds] [heading]"
    );
  }
  const elapsed = started ? Date.now() - Number(started) * 1000 : undefined;
  let report;
  try {
    report = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    process.stdout.write(summariseMissing(project, elapsed, heading || undefined));
    process.exit(0);
  }
  process.stdout.write(summarise(report, project, heading || undefined));
}
