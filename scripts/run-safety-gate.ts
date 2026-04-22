/* eslint-disable no-console */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Mode = "review" | "ci-review" | "release";

type ResultStatus = "PASS" | "FAIL" | "SKIPPED" | "DRY_RUN" | "SOFT_FAIL";

type Step = {
  name: string;
  args: string[];
  optional?: boolean;
  nonBlocking?: boolean;
};

type StepResult = {
  name: string;
  command: string;
  optional: boolean;
  status: ResultStatus;
  exitCode: number | null;
  durationMs: number;
};

type SafetyGateReport = {
  mode: Mode;
  verdict: "PASS" | "FAIL" | "DRY_RUN";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  flags: {
    failFast: boolean;
    dryRun: boolean;
    skipOptional: boolean;
  };
  stepsPlanned: number;
  stepsExecuted: number;
  failedSteps: string[];
  softFailedSteps: string[];
  results: StepResult[];
};

type BlockerSummary = {
  mode: Mode;
  verdict: "PASS" | "FAIL" | "DRY_RUN";
  totalBlockers: number;
  blockers: string[];
  reportJsonPath: string;
  reportMarkdownPath: string;
  generatedAt: string;
};

const reviewSteps: Step[] = [
  { name: "Lint", args: ["lint"] },
  { name: "Typecheck", args: ["typecheck"] },
  { name: "OpenAPI drift", args: ["quality:openapi-drift"] },
  { name: "Dead-code scan", args: ["knip"] },
  { name: "Import graph", args: ["depcruise"] },
  { name: "Duplication scan", args: ["jscpd"], optional: true, nonBlocking: true },
  { name: "Blocking tests", args: ["test:blocking"] },
  { name: "Preflight", args: ["preflight"] },
  { name: "Secret scan", args: ["secret-scan"] },
  { name: "Security audit", args: ["security:audit"] },
  { name: "License check", args: ["licenses:check"] },
  { name: "DB invariants", args: ["db:check-invariants"] },
];

const ciReviewSteps: Step[] = [
  { name: "Lint", args: ["lint"] },
  { name: "Typecheck", args: ["typecheck"] },
  { name: "OpenAPI drift", args: ["quality:openapi-drift"] },
  { name: "Dead-code scan", args: ["knip"] },
  { name: "Import graph", args: ["depcruise"] },
  { name: "Duplication scan", args: ["jscpd"], optional: true, nonBlocking: true },
  { name: "Blocking tests", args: ["test:blocking"] },
  { name: "Preflight", args: ["preflight"], nonBlocking: true },
  { name: "Secret scan", args: ["secret-scan"] },
  { name: "Security audit", args: ["security:audit"] },
  { name: "License check", args: ["licenses:check"] },
  { name: "DB invariants", args: ["db:check-invariants"] },
];

const releaseOnlySteps: Step[] = [
  { name: "Build", args: ["build"] },
  {
    name: "Playwright smoke",
    args: [
      "exec",
      "playwright",
      "test",
      "--grep",
      "@smoke",
      "--project",
      "chromium",
      "--project",
      "mobile-chrome",
    ],
  },
  { name: "Launch env validation", args: ["validate:launch-env"] },
  { name: "Production edge preflight", args: ["preflight:prod:edge"] },
  { name: "Launch flows bundle", args: ["test:launch:flows"], optional: true },
];

function usage(): void {
  console.log(
    "Usage: tsx scripts/run-safety-gate.ts <review|ci-review|release> [--fail-fast] [--dry-run] [--skip-optional]"
  );
}

function commandForStep(step: Step): string {
  return `pnpm ${step.args.join(" ")}`;
}

function spawnPnpm(args: string[]) {
  if (process.platform === "win32") {
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/c", "pnpm", ...args], {
      stdio: "inherit",
    });
  }

  return spawnSync("pnpm", args, {
    stdio: "inherit",
  });
}

function resolveMode(value: string | undefined): Mode | null {
  if (value === "review" || value === "ci-review" || value === "release") {
    return value;
  }
  return null;
}

function buildSteps(mode: Mode): Step[] {
  if (mode === "review") {
    return reviewSteps;
  }

  if (mode === "ci-review") {
    return ciReviewSteps;
  }

  return [...reviewSteps, ...releaseOnlySteps];
}

function formatMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function toTimestamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = now.getUTCFullYear();
  const mm = pad(now.getUTCMonth() + 1);
  const dd = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const mi = pad(now.getUTCMinutes());
  const ss = pad(now.getUTCSeconds());
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function markdownForReport(report: SafetyGateReport): string {
  const lines: string[] = [];
  lines.push("# Safety Gate Report");
  lines.push("");
  lines.push(`- mode: ${report.mode}`);
  lines.push(`- verdict: ${report.verdict}`);
  lines.push(`- startedAt: ${report.startedAt}`);
  lines.push(`- finishedAt: ${report.finishedAt}`);
  lines.push(`- duration: ${formatMs(report.durationMs)}`);
  lines.push("");
  lines.push("## Step Results");
  lines.push("");
  lines.push("| status | step | command | duration |");
  lines.push("| --- | --- | --- | --- |");

  for (const result of report.results) {
    lines.push(
      `| ${result.status} | ${result.name} | ${result.command} | ${formatMs(result.durationMs)} |`
    );
  }

  if (report.failedSteps.length > 0) {
    lines.push("");
    lines.push("## Failed Steps");
    lines.push("");
    for (const failedStep of report.failedSteps) {
      lines.push(`- ${failedStep}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function writeReportArtifacts(mode: Mode, report: SafetyGateReport): Promise<void> {
  const reportDir = process.env.SAFETY_GATE_REPORT_DIR || "tmp/safety-gate";
  const timestamp = toTimestamp(new Date());
  const jsonName = `safety-${mode}-${timestamp}.json`;
  const mdName = `safety-${mode}-${timestamp}.md`;
  const blockersJsonName = `safety-${mode}-blockers-${timestamp}.json`;
  const blockersTxtName = `safety-${mode}-blockers-${timestamp}.txt`;
  const jsonPath = path.join(reportDir, jsonName);
  const mdPath = path.join(reportDir, mdName);
  const blockersJsonPath = path.join(reportDir, blockersJsonName);
  const blockersTxtPath = path.join(reportDir, blockersTxtName);
  const latestJsonPath = path.join(reportDir, `latest-${mode}.json`);
  const latestMdPath = path.join(reportDir, `latest-${mode}.md`);
  const latestBlockersJsonPath = path.join(reportDir, `latest-${mode}-blockers.json`);
  const latestBlockersTxtPath = path.join(reportDir, `latest-${mode}-blockers.txt`);
  const latestAnyJsonPath = path.join(reportDir, "latest.json");
  const latestAnyMdPath = path.join(reportDir, "latest.md");
  const latestAnyBlockersJsonPath = path.join(reportDir, "latest-blockers.json");
  const latestAnyBlockersTxtPath = path.join(reportDir, "latest-blockers.txt");

  await mkdir(reportDir, { recursive: true });

  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = markdownForReport(report);
  const blockers: BlockerSummary = {
    mode,
    verdict: report.verdict,
    totalBlockers: report.failedSteps.length,
    blockers: report.failedSteps,
    reportJsonPath: jsonPath,
    reportMarkdownPath: mdPath,
    generatedAt: new Date().toISOString(),
  };
  const blockersJson = `${JSON.stringify(blockers, null, 2)}\n`;
  const blockersLines = [
    `mode=${mode}`,
    `verdict=${report.verdict}`,
    `total_blockers=${report.failedSteps.length}`,
    `report_json=${jsonPath}`,
    `report_markdown=${mdPath}`,
    report.failedSteps.length === 0 ? "blockers=none" : `blockers=${report.failedSteps.join(",")}`,
  ];
  const blockersTxt = `${blockersLines.join("\n")}\n`;

  await writeFile(jsonPath, json, "utf8");
  await writeFile(mdPath, markdown, "utf8");
  await writeFile(blockersJsonPath, blockersJson, "utf8");
  await writeFile(blockersTxtPath, blockersTxt, "utf8");
  await writeFile(latestJsonPath, json, "utf8");
  await writeFile(latestMdPath, markdown, "utf8");
  await writeFile(latestBlockersJsonPath, blockersJson, "utf8");
  await writeFile(latestBlockersTxtPath, blockersTxt, "utf8");
  await writeFile(latestAnyJsonPath, json, "utf8");
  await writeFile(latestAnyMdPath, markdown, "utf8");
  await writeFile(latestAnyBlockersJsonPath, blockersJson, "utf8");
  await writeFile(latestAnyBlockersTxtPath, blockersTxt, "utf8");

  console.log(`Report JSON: ${jsonPath}`);
  console.log(`Report Markdown: ${mdPath}`);
  console.log(`Blockers JSON: ${blockersJsonPath}`);
  console.log(`Blockers Text: ${blockersTxtPath}`);
}

async function main(): Promise<void> {
  const mode = resolveMode(process.argv[2]);
  const flags = new Set(process.argv.slice(3));

  if (!mode) {
    usage();
    process.exit(1);
  }

  const failFast = flags.has("--fail-fast");
  const dryRun = flags.has("--dry-run");
  const skipOptional = flags.has("--skip-optional");

  const steps = buildSteps(mode).filter((step) => !(skipOptional && step.optional));
  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();

  console.log(`Running safety gate mode: ${mode}`);
  console.log(`Flags: failFast=${failFast}, dryRun=${dryRun}, skipOptional=${skipOptional}`);

  const results: StepResult[] = [];

  if (dryRun) {
    for (const step of steps) {
      const command = commandForStep(step);
      console.log(`- ${step.name}: ${command}`);
      results.push({
        name: step.name,
        command,
        optional: !!step.optional,
        status: "DRY_RUN",
        exitCode: null,
        durationMs: 0,
      });
    }
  } else {
    for (const step of steps) {
      console.log("\n============================================================");
      console.log(`Step: ${step.name}`);
      console.log(`Command: ${commandForStep(step)}`);
      console.log("============================================================");

      const stepStartedAt = Date.now();
      const result = spawnPnpm(step.args);
      const durationMs = Date.now() - stepStartedAt;
      const exitCode = result.status ?? 1;
      const status: ResultStatus =
        exitCode === 0 ? "PASS" : step.nonBlocking ? "SOFT_FAIL" : "FAIL";

      results.push({
        name: step.name,
        command: commandForStep(step),
        optional: !!step.optional,
        status,
        exitCode,
        durationMs,
      });

      if (status === "FAIL") {
        console.error(`Step failed: ${step.name} (${formatMs(durationMs)})`);
        if (failFast) {
          const currentIndex = steps.findIndex((candidate) => candidate === step);
          const skipped = steps.slice(currentIndex + 1);
          for (const skippedStep of skipped) {
            results.push({
              name: skippedStep.name,
              command: commandForStep(skippedStep),
              optional: !!skippedStep.optional,
              status: "SKIPPED",
              exitCode: null,
              durationMs: 0,
            });
          }
          break;
        }
      } else if (status === "SOFT_FAIL") {
        console.warn(`Step soft-failed (non-blocking): ${step.name} (${formatMs(durationMs)})`);
      } else {
        console.log(`Step passed: ${step.name} (${formatMs(durationMs)})`);
      }
    }
  }

  const failed = results.filter((entry) => entry.status === "FAIL");
  const softFailed = results.filter((entry) => entry.status === "SOFT_FAIL");
  const totalDurationMs = Date.now() - startedAtMs;
  const finishedAtIso = new Date().toISOString();
  const verdict: "PASS" | "FAIL" | "DRY_RUN" = dryRun
    ? "DRY_RUN"
    : failed.length > 0
      ? "FAIL"
      : "PASS";

  const report: SafetyGateReport = {
    mode,
    verdict,
    startedAt: startedAtIso,
    finishedAt: finishedAtIso,
    durationMs: totalDurationMs,
    flags: {
      failFast,
      dryRun,
      skipOptional,
    },
    stepsPlanned: steps.length,
    stepsExecuted: results.filter((entry) => entry.status === "PASS" || entry.status === "FAIL")
      .length,
    failedSteps: failed.map((entry) => entry.name),
    softFailedSteps: softFailed.map((entry) => entry.name),
    results,
  };

  await writeReportArtifacts(mode, report);

  console.log("\n======================== Safety Gate Summary ========================");
  for (const result of results) {
    console.log(`${result.status} | ${result.name} | ${formatMs(result.durationMs)}`);
  }
  console.log("====================================================================");
  console.log(`Total duration: ${formatMs(totalDurationMs)}`);
  console.log(`Steps planned: ${steps.length}`);
  console.log(`Steps executed: ${report.stepsExecuted}`);
  console.log(`Failed steps: ${failed.length}`);
  console.log(`Soft-failed steps: ${softFailed.length}`);
  console.log(`Verdict: ${verdict}`);

  if (verdict === "FAIL") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Safety gate runner crashed:", error);
  process.exit(1);
});
