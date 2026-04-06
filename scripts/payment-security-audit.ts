/* eslint-disable no-console */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Verdict = "PASS" | "WARN" | "FAIL" | "DRY_RUN";

type Category = "repo_runtime" | "live_deployment" | "local_production_env";

type Step = {
  name: string;
  args: string[];
  category: Category;
  notes?: string;
};

type StepResult = {
  name: string;
  category: Category;
  command: string;
  status: Verdict;
  exitCode: number | null;
  durationMs: number;
  warnings: string[];
  findings: string[];
};

type AuditFinding = {
  severity: "High" | "Medium" | "Low";
  scope: Category | "overall";
  title: string;
  detail: string;
};

type AuditReport = {
  verdict: Verdict;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  categories: Record<Category, Verdict>;
  steps: StepResult[];
  findings: AuditFinding[];
  controlEvidence: Array<{
    area: string;
    summary: string;
    paths: string[];
  }>;
};

const steps: Step[] = [
  {
    name: "Safety review",
    args: ["safety:review"],
    category: "repo_runtime",
    notes:
      "Lint, typecheck, blocking tests, preflight, secret scan, dependency audit, license checks, DB invariants.",
  },
  {
    name: "Launch flows bundle",
    args: ["test:launch:flows"],
    category: "repo_runtime",
    notes: "Billing, OTP, DSAR route tests plus Ozow round-trip Playwright coverage.",
  },
  {
    name: "Smoke checks",
    args: ["test:smoke"],
    category: "live_deployment",
    notes:
      "Confirms live routes answer safely, including auth-gated checkout and signed webhook rejection.",
  },
  {
    name: "Cloudflare secrets check",
    args: ["cloudflare:secrets:check"],
    category: "live_deployment",
    notes: "Confirms required launch secrets are deployed and bypass secrets are absent.",
  },
  {
    name: "Cloudflare posture check",
    args: ["cloudflare:posture:strict"],
    category: "live_deployment",
    notes: "Checks TLS/HSTS/health/DNS posture of the public deployment.",
  },
  {
    name: "Launch env validation",
    args: ["validate:launch-env"],
    category: "local_production_env",
    notes:
      "Validates this workstation's production env contract; useful but not authoritative for deployed runtime.",
  },
];

const controlEvidence: AuditReport["controlEvidence"] = [
  {
    area: "Subscriptions",
    summary:
      "Checkout, change-plan, cancel, payment-status, and webhook routes enforce auth, origin/CSRF checks, rate limits, signature validation, amount/currency matching, and duplicate-payment guards.",
    paths: [
      "src/app/api/billing/create-checkout/route.ts",
      "src/app/api/billing/change-plan/route.ts",
      "src/app/api/billing/cancel/route.ts",
      "src/app/api/billing/payment-status/route.ts",
      "src/app/api/webhooks/ozow/route.ts",
    ],
  },
  {
    area: "Fulfillment",
    summary:
      "Payment fulfillment provisions entitlements idempotently, writes one invoice per payment, handles plan replacement, and scopes paid effects to owned resources.",
    paths: ["src/lib/payments/fulfillment.ts", "src/lib/payments/store.ts"],
  },
  {
    area: "Paid add-ons",
    summary:
      "Listing, business, and promotion add-on routes all pass through hosted checkout creation with ownership checks, entitlement gates, duplicate in-flight payment protection, and audit logging.",
    paths: [
      "src/app/api/listings/[id]/boost/route.ts",
      "src/app/api/listings/[id]/featured/route.ts",
      "src/app/api/listings/[id]/urgent/route.ts",
      "src/app/api/businesses/[id]/boost/route.ts",
      "src/app/api/promotions/[id]/boost/route.ts",
      "src/app/api/promotions/[id]/featured/route.ts",
    ],
  },
];

function spawnPnpm(args: string[]): SpawnSyncReturns<string> {
  const options = {
    encoding: "utf8" as const,
    stdio: "pipe" as const,
    maxBuffer: 100 * 1024 * 1024,
  };

  if (process.platform === "win32") {
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/c", "pnpm", ...args], options);
  }

  return spawnSync("pnpm", args, options);
}

function commandForStep(step: Step): string {
  return `pnpm ${step.args.join(" ")}`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function countPatternMatches(text: string, pattern: RegExp): string[] {
  return Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .filter((line) => pattern.test(line))
        .map((line) => line.trim())
    )
  );
}

function evaluateStep(step: Step, output: string, exitCode: number | null): StepResult {
  const warnings: string[] = [];
  const findings: string[] = [];

  if (step.name === "Cloudflare posture check") {
    warnings.push(...countPatternMatches(output, /^WARN:/));
  }

  if (step.name === "Launch env validation") {
    findings.push(...countPatternMatches(output, /^\s*✗ /));
  }

  const status: Verdict = exitCode === 0 ? (warnings.length > 0 ? "WARN" : "PASS") : "FAIL";

  return {
    name: step.name,
    category: step.category,
    command: commandForStep(step),
    status,
    exitCode,
    durationMs: 0,
    warnings,
    findings,
  };
}

function resolveCategoryVerdict(stepResults: StepResult[], category: Category): Verdict {
  const categorySteps = stepResults.filter((step) => step.category === category);
  if (categorySteps.some((step) => step.status === "FAIL")) return "FAIL";
  if (categorySteps.some((step) => step.status === "WARN")) return "WARN";
  if (categorySteps.some((step) => step.status === "DRY_RUN")) return "DRY_RUN";
  return "PASS";
}

function resolveOverallVerdict(categories: Record<Category, Verdict>, dryRun: boolean): Verdict {
  if (dryRun) return "DRY_RUN";
  if (Object.values(categories).some((verdict) => verdict === "FAIL")) return "FAIL";
  if (Object.values(categories).some((verdict) => verdict === "WARN")) return "WARN";
  return "PASS";
}

function buildFindings(
  categories: Record<Category, Verdict>,
  stepResults: StepResult[]
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  if (categories.repo_runtime === "FAIL") {
    const failedSteps = stepResults
      .filter((step) => step.category === "repo_runtime" && step.status === "FAIL")
      .map((step) => step.name);
    findings.push({
      severity: "High",
      scope: "repo_runtime",
      title: "Repo/runtime audit bundle is failing",
      detail: `Blocking audit steps failed: ${failedSteps.join(", ")}.`,
    });
  }

  const envStep = stepResults.find((step) => step.name === "Launch env validation");
  if (categories.local_production_env === "FAIL" && envStep) {
    const details = Array.from(new Set(envStep.findings));
    findings.push({
      severity: "High",
      scope: "local_production_env",
      title: "This workstation is not production-launch ready",
      detail:
        details.join("; ") ||
        "Local production env validation failed. Review validate:launch-env output.",
    });
  }

  const postureStep = stepResults.find((step) => step.name === "Cloudflare posture check");
  if (postureStep?.warnings.some((line) => line.includes("DNSSEC DS record"))) {
    findings.push({
      severity: "Medium",
      scope: "live_deployment",
      title: "DNSSEC DS record is still missing",
      detail: "Registrar-side DS record enablement is still outstanding for the live domain.",
    });
  }

  if (postureStep?.warnings.some((line) => line.includes("HTTP protocol: http/1.1"))) {
    findings.push({
      severity: "Low",
      scope: "live_deployment",
      title: "HTTP/1.1 is observed on the live probe",
      detail:
        "This is informational in the current posture check output and did not block the deployment gate.",
    });
  }

  return findings;
}

function toTimestamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    [now.getUTCFullYear(), pad(now.getUTCMonth() + 1), pad(now.getUTCDate())].join("") +
    "-" +
    [pad(now.getUTCHours()), pad(now.getUTCMinutes()), pad(now.getUTCSeconds())].join("")
  );
}

function markdownForReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push("# VerifyMzansi Payment Security Audit");
  lines.push("");
  lines.push(`- verdict: ${report.verdict}`);
  lines.push(`- startedAt: ${report.startedAt}`);
  lines.push(`- finishedAt: ${report.finishedAt}`);
  lines.push(`- duration: ${formatMs(report.durationMs)}`);
  lines.push("");
  lines.push("## Category Verdicts");
  lines.push("");
  lines.push(`- repo/runtime: ${report.categories.repo_runtime}`);
  lines.push(`- live deployment: ${report.categories.live_deployment}`);
  lines.push(`- local production env readiness: ${report.categories.local_production_env}`);
  lines.push("");
  lines.push("## Check Results");
  lines.push("");
  lines.push("| status | category | step | command |");
  lines.push("| --- | --- | --- | --- |");
  for (const step of report.steps) {
    lines.push(`| ${step.status} | ${step.category} | ${step.name} | \`${step.command}\` |`);
  }

  lines.push("");
  lines.push("## Findings");
  lines.push("");
  if (report.findings.length === 0) {
    lines.push("- No audit findings. All tracked controls passed.");
  } else {
    for (const finding of report.findings) {
      lines.push(`- ${finding.severity}: ${finding.title} (${finding.scope}) — ${finding.detail}`);
    }
  }

  lines.push("");
  lines.push("## Paid Flow Control Evidence");
  lines.push("");
  for (const entry of report.controlEvidence) {
    lines.push(`- ${entry.area}: ${entry.summary}`);
    lines.push(`  Paths: ${entry.paths.join(", ")}`);
  }

  lines.push("");
  lines.push("## Assumptions");
  lines.push("");
  lines.push(
    "- Live deployment checks are read-only and do not include direct Ozow dashboard/provider-console verification."
  );
  lines.push(
    "- Local `validate:launch-env` reflects this workstation's production env contract, not the deployed runtime by itself."
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function writeArtifacts(report: AuditReport): Promise<void> {
  const reportDir = process.env.PAYMENT_AUDIT_REPORT_DIR || "tmp/payment-security-audit";
  const timestamp = toTimestamp(new Date());
  const jsonPath = path.join(reportDir, `payment-security-audit-${timestamp}.json`);
  const mdPath = path.join(reportDir, `payment-security-audit-${timestamp}.md`);
  const latestJsonPath = path.join(reportDir, "latest.json");
  const latestMdPath = path.join(reportDir, "latest.md");

  await mkdir(reportDir, { recursive: true });

  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = markdownForReport(report);

  await writeFile(jsonPath, json, "utf8");
  await writeFile(mdPath, markdown, "utf8");
  await writeFile(latestJsonPath, json, "utf8");
  await writeFile(latestMdPath, markdown, "utf8");

  console.log(`Report JSON: ${jsonPath}`);
  console.log(`Report Markdown: ${mdPath}`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const startedAt = new Date();
  const stepResults: StepResult[] = [];

  console.log("Running VerifyMzansi payment security audit...");
  console.log(`Dry run: ${dryRun}`);

  for (const step of steps) {
    if (dryRun) {
      console.log(`- ${step.name}: ${commandForStep(step)}`);
      stepResults.push({
        name: step.name,
        category: step.category,
        command: commandForStep(step),
        status: "DRY_RUN",
        exitCode: null,
        durationMs: 0,
        warnings: [],
        findings: [],
      });
      continue;
    }

    console.log("\n============================================================");
    console.log(`Step: ${step.name}`);
    console.log(`Category: ${step.category}`);
    console.log(`Command: ${commandForStep(step)}`);
    if (step.notes) {
      console.log(`Notes: ${step.notes}`);
    }
    console.log("============================================================");

    const stepStartedAt = Date.now();
    const result = spawnPnpm(step.args);
    const durationMs = Date.now() - stepStartedAt;
    const output = `${result.stdout ?? ""}${result.stderr ? `\n${result.stderr}` : ""}`;

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    const evaluated = evaluateStep(step, output, result.status ?? 1);
    evaluated.durationMs = durationMs;
    stepResults.push(evaluated);

    console.log(`Step verdict: ${evaluated.status} (${formatMs(durationMs)})`);
  }

  const categories: Record<Category, Verdict> = {
    repo_runtime: resolveCategoryVerdict(stepResults, "repo_runtime"),
    live_deployment: resolveCategoryVerdict(stepResults, "live_deployment"),
    local_production_env: resolveCategoryVerdict(stepResults, "local_production_env"),
  };

  const report: AuditReport = {
    verdict: resolveOverallVerdict(categories, dryRun),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    dryRun,
    categories,
    steps: stepResults,
    findings: buildFindings(categories, stepResults),
    controlEvidence,
  };

  await writeArtifacts(report);

  console.log("\n==================== Payment Audit Summary ====================");
  console.log(`Overall verdict: ${report.verdict}`);
  console.log(`Repo/runtime: ${report.categories.repo_runtime}`);
  console.log(`Live deployment: ${report.categories.live_deployment}`);
  console.log(`Local production env readiness: ${report.categories.local_production_env}`);
  console.log(`Duration: ${formatMs(report.durationMs)}`);
  console.log("================================================================");

  if (report.verdict === "FAIL") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Payment security audit crashed:", error);
  process.exit(1);
});
