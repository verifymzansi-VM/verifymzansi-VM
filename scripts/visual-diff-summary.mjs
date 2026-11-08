#!/usr/bin/env node
// Turns the Playwright JSON report of e2e/visual-regression.spec.ts into a
// short Markdown summary for the CI job page: which screens differ from the
// approved pictures of the chosen frontend, and by how much (roadmap M0.12).
//
// Usage: node scripts/visual-diff-summary.mjs <report.json>  (prints Markdown)

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ESCAPES = /\u001b\[[0-9;]*m/g;

/** @param {any} suite @param {string[]} titles @param {any[]} out */
function collect(suite, titles, out) {
  const path = suite.title ? [...titles, suite.title] : titles;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      out.push({ titles: [...path, spec.title], test });
    }
  }
  for (const child of suite.suites ?? []) collect(child, path, out);
}

/** @param {string} message */
function describeFailure(message) {
  const text = message.replace(ESCAPES, "");
  const ratio = text.match(/(\d+) pixels \(ratio ([\d.]+) of all image pixels\) are different/);
  if (ratio) return `${ratio[1]} pixels differ (${(Number(ratio[2]) * 100).toFixed(2)}%)`;
  if (/Expected an image \d+px by \d+px, received \d+px by \d+px/.test(text)) {
    const size = text.match(/Expected an image (\d+px by \d+px), received (\d+px by \d+px)/);
    return `page size changed (${size?.[1]} approved, ${size?.[2]} now)`;
  }
  if (/snapshot doesn't exist|A snapshot doesn't exist/.test(text)) return "no approved picture";
  return (text.split("\n").find((line) => line.trim()) ?? "failed").trim().slice(0, 160);
}

/**
 * @param {any} report Playwright JSON report
 * @returns {string} Markdown
 */
export function summarise(report) {
  const rows = [];
  for (const suite of report.suites ?? []) collect(suite, [], rows);
  const tests = rows.filter((row) => row.test.status !== "skipped");
  const skipped = rows.length - tests.length;
  const failed = tests.filter((row) => row.test.status === "unexpected");
  const flaky = tests.filter((row) => row.test.status === "flaky");

  const lines = ["## Picture check against the chosen frontend (0b562f42)", ""];
  lines.push(
    `${tests.length} screens compared, ${failed.length} differ, ${flaky.length} flaky, ${skipped} skipped.`
  );
  lines.push("");
  if (failed.length === 0) {
    lines.push("Every screen matches its approved picture.");
  } else {
    lines.push("| Screen | Difference |", "| --- | --- |");
    for (const row of failed) {
      const results = row.test.results ?? [];
      const last = results[results.length - 1];
      const message = last?.errors?.[0]?.message ?? last?.error?.message ?? "";
      const name = row.titles.filter((title) => !title.endsWith(".spec.ts")).join(" › ");
      lines.push(`| ${name} | ${describeFailure(message).replace(/\|/g, "/")} |`);
    }
    lines.push(
      "",
      "Expected, actual and diff images are in this run's `visual-regression` artifact.",
      "A difference is either approved by the owner (new picture on a pull request) or put back."
    );
  }
  return `${lines.join("\n")}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: visual-diff-summary.mjs <report.json>");
  let report;
  try {
    report = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    process.stdout.write(
      "## Picture check against the chosen frontend (0b562f42)\n\nNo report: the run stopped before any screen was compared. See the job log.\n"
    );
    process.exit(0);
  }
  process.stdout.write(summarise(report));
}
