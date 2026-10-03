import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { CHECKS, selectChecks, type AuditMode, type Check } from "./check-registry";
export type Status = "PASS" | "FAIL" | "WARN" | "SKIPPED" | "UNAVAILABLE" | "TIMED_OUT" | "DRY_RUN";
export type CheckResult = {
  id: string;
  name: string;
  command: string;
  category: Check["category"];
  optional: boolean;
  required: boolean;
  status: Status;
  exitCode: number | null;
  durationMs: number;
  executed: boolean;
  warnings: string[];
  findings: string[];
  evidence: string[];
  reason?: string;
};
export function redact(text: string, env = process.env): string {
  let safe = text;
  for (const [name, value] of Object.entries(env)) {
    if (
      value &&
      value.length >= 8 &&
      /SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|SERVICE_ROLE|ENCRYPTION_KEY/i.test(name)
    )
      safe = safe.split(value).join("[REDACTED]");
  }
  return safe
    .replace(/(Bearer\s+)[\w.+/=-]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sb_secret_|sbp_|sk_live_|xox[baprs]-)[\w-]+/g, "[REDACTED]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[REDACTED]@");
}
export function parseArguments(args: string[]) {
  const accepted = new Set([
    "--fail-fast",
    "--dry-run",
    "--skip-optional",
    "--local-only",
    "--help",
  ]);
  const flags = new Set<string>();
  let ids: string[] | undefined;
  let timeoutMs: number | undefined;
  for (const arg of args.filter((arg) => arg !== "--")) {
    if (accepted.has(arg)) flags.add(arg);
    else if (arg.startsWith("--checks=") && !ids) {
      ids = arg.slice(9).split(",");
      if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
        throw new Error("Expected unique, nonempty --checks ids");
      selectChecks("inventory", ids);
    } else if (arg.startsWith("--timeout-ms=") && timeoutMs === undefined) {
      timeoutMs = Number(arg.slice(13));
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000)
        throw new Error("Timeout must be 1..3600000 milliseconds");
    } else throw new Error(`Unsupported argument: ${arg}`);
  }
  return { flags, ids, timeoutMs };
}
// Registry-owned arguments only; callers cannot inject arbitrary shell arguments.
export function pnpmInvocation(
  args: string[],
  platform: string = process.platform
): [string, string[]] {
  return platform === "win32"
    ? [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "pnpm", ...args]]
    : ["pnpm", args];
}
export async function execute(
  command: string,
  args: string[],
  timeoutMs: number,
  env = process.env,
  cwd?: string
) {
  const start = Date.now();
  return await new Promise<{
    output: string;
    exitCode: number | null;
    status: Status;
    durationMs: number;
  }>((resolve) => {
    let output = "";
    let timedOut = false;
    let error: Error | undefined;
    let truncated = false;
    const child = spawn(command, args, {
      env,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const collect = (chunk: Buffer) => {
      if (output.length < 16_000_000) output += chunk.toString();
      else truncated = true;
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", (err) => {
      error = err;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && child.pid)
        spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          windowsHide: true,
          timeout: 10_000,
          stdio: "ignore",
        });
      else if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (error) output += `\nFailed to start: ${error.message}`;
      if (truncated) output += "\nCapture limit exceeded; evidence incomplete";
      resolve({
        output: redact(output, env),
        exitCode: code,
        status: timedOut
          ? "TIMED_OUT"
          : error || truncated
            ? "UNAVAILABLE"
            : code === 2
              ? "UNAVAILABLE"
              : code === 0
                ? "PASS"
                : "FAIL",
        durationMs: Date.now() - start,
      });
    });
  });
}
export function assessment(results: CheckResult[], dryRun: boolean) {
  if (dryRun) return "DRY_RUN" as const;
  if (results.some((r) => r.required && r.status === "FAIL")) return "FAIL" as const;
  if (results.some((r) => r.required && !["PASS", "WARN"].includes(r.status)))
    return "INCOMPLETE" as const;
  return results.some((r) => r.status !== "PASS") ? ("WARN" as const) : ("PASS" as const);
}
function git(args: string[]) {
  const result = spawnSync("git", args, { encoding: "utf8", timeout: 10_000 });
  return result.status === 0 ? result.stdout.trim() : "unavailable";
}
export async function runAudit(mode: AuditMode, args = process.argv.slice(2), runner = execute) {
  loadEnvConfig(process.cwd(), undefined, { info: () => {}, error: () => {} });
  const startedAt = new Date().toISOString();
  const runId = `${startedAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const reportDir =
    mode === "payments"
      ? process.env.PAYMENT_AUDIT_REPORT_DIR || "tmp/payment-security-audit"
      : mode === "kyc"
        ? "tmp/kyc-audit"
        : process.env.SAFETY_GATE_REPORT_DIR || "tmp/safety-gate";
  await mkdir(path.join(reportDir, runId), { recursive: true });
  const results: CheckResult[] = [];
  let argumentError: string | undefined;
  let options: ReturnType<typeof parseArguments> = {
    flags: new Set(),
    ids: undefined,
    timeoutMs: undefined,
  };
  try {
    options = parseArguments(args);
  } catch (error) {
    argumentError = redact(String(error));
  }
  const { flags } = options;
  if (flags.has("--help")) {
    process.stdout.write(
      "Audit flags: --dry-run --fail-fast --skip-optional --local-only --checks=id,id --timeout-ms=600000\n"
    );
    return;
  }
  const selected = argumentError ? [] : selectChecks(mode, options.ids);
  const startingWorkingTree = git(["status", "--porcelain=v1"]);
  const checkpoint = async () =>
    writeFile(
      path.join(reportDir, runId, "progress.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          runId,
          mode,
          assessment: "INCOMPLETE",
          releaseReady: false,
          startedAt,
          updatedAt: new Date().toISOString(),
          commit: git(["rev-parse", "HEAD"]),
          startingWorkingTree,
          selectedScope: selected.map((c) => c.id),
          results,
          pendingChecks: selected
            .filter((c) => !results.some((r) => r.id === c.id))
            .map((c) => c.id),
          reason: "Run has not completed; interruption never implies passing",
        },
        null,
        2
      )
    );
  await checkpoint();
  let stopped = false;
  for (const check of selected) {
    const required = !check.advisory && !(mode === "ci-review" && check.id === "preflight");
    const row: CheckResult = {
      id: check.id,
      name: check.name,
      command: check.args.length ? `pnpm ${check.args.join(" ")}` : "external evidence",
      category: check.category,
      optional: !!check.optional,
      required,
      status: "SKIPPED",
      exitCode: null,
      durationMs: 0,
      executed: false,
      warnings: [],
      findings: [],
      evidence: [],
    };
    if (stopped) row.reason = "Previous required check failed (--fail-fast)";
    else if (flags.has("--skip-optional") && check.optional)
      row.reason = "Optional check explicitly omitted";
    else if (flags.has("--local-only") && check.external)
      row.reason = "External verification omitted (--local-only)";
    else if (flags.has("--dry-run")) {
      row.status = "DRY_RUN";
      row.reason = "Planned only; no control verified";
    } else if (check.unavailable) {
      row.status = "UNAVAILABLE";
      row.reason = check.unavailable;
    } else {
      process.stdout.write(
        `Starting ${check.id}: ${row.command} (timeout ${options.timeoutMs ?? check.timeoutMs}ms)\n`
      );
      const [command, commandArgs] = pnpmInvocation(check.args);
      let result: Awaited<ReturnType<typeof execute>>;
      try {
        result = await runner(command, commandArgs, options.timeoutMs ?? check.timeoutMs);
      } catch (error) {
        result = {
          status: "UNAVAILABLE",
          exitCode: null,
          durationMs: 0,
          output: redact(`Execution failed: ${String(error)}`),
        };
      }
      Object.assign(row, {
        status: result.status,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        executed: true,
      });
      row.warnings = result.output
        .split(/\r?\n/)
        .filter((line) =>
          /^(?:WARN(?:ING)?\b|::warning::|\s*(?:⚠|▲\s*\[WARNING\]|!\s))/i.test(line)
        )
        .slice(0, 100);
      if (row.status === "PASS" && row.warnings.length) row.status = "WARN";
      if (!required && row.status === "FAIL") {
        row.status = "WARN";
        row.warnings.push("Advisory command failed; inspect evidence");
      }
      const log = path.join(reportDir, runId, `${check.id}.log`);
      await writeFile(log, result.output);
      row.evidence.push(log);
      if (row.status !== "PASS") row.reason = `${row.command}: ${row.status}; inspect ${log}`;
      process.stdout.write(`${check.id}: ${row.status}\n`);
    }
    results.push(row);
    await checkpoint();
    if (flags.has("--fail-fast") && required && !["PASS", "WARN", "DRY_RUN"].includes(row.status))
      stopped = true;
  }
  const verdict = argumentError ? "FAIL" : assessment(results, flags.has("--dry-run"));
  const blockers = results
    .filter((r) => r.required && !["PASS", "WARN"].includes(r.status))
    .map((r) => r.name);
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const installedVersions: Record<string, string> = {};
  for (const name of [
    "next",
    "vitest",
    "typescript",
    "eslint",
    "knip",
    "jscpd",
    "dependency-cruiser",
    "@playwright/test",
  ]) {
    try {
      installedVersions[name] = JSON.parse(
        await readFile(`node_modules/${name}/package.json`, "utf8")
      ).version;
    } catch {
      installedVersions[name] = "unavailable";
    }
  }
  const report = {
    schemaVersion: 2,
    runId,
    mode,
    verdict,
    assessment: verdict,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - Date.parse(startedAt),
    commit: git(["rev-parse", "HEAD"]),
    workingTree: git(["status", "--porcelain=v1"]),
    startingWorkingTree,
    toolVersions: {
      installed: installedVersions,
      node: process.version,
      pnpm: pkg.packageManager,
      next: pkg.dependencies.next,
      platform: process.platform,
    },
    targetEnvironment:
      mode === "release" ? "local + read-only deployment" : "local; external only when selected",
    selectedScope: selected.map((c) => c.id),
    flags: {
      failFast: flags.has("--fail-fast"),
      dryRun: flags.has("--dry-run"),
      skipOptional: flags.has("--skip-optional"),
      localOnly: flags.has("--local-only"),
    },
    dryRun: flags.has("--dry-run"),
    partialScope: !!options.ids,
    releaseReady:
      mode === "release" &&
      !options.ids &&
      !flags.has("--dry-run") &&
      ["PASS", "WARN"].includes(verdict),
    stepsPlanned: selected.length,
    stepsExecuted: results.filter((r) => r.executed).length,
    failedSteps: results.filter((r) => r.status === "FAIL").map((r) => r.name),
    softFailedSteps: results.filter((r) => r.status === "WARN").map((r) => r.name),
    blockers,
    argumentError,
    warnings: results.flatMap((r) => r.warnings),
    skips: results
      .filter((r) => ["UNAVAILABLE", "SKIPPED", "TIMED_OUT", "DRY_RUN"].includes(r.status))
      .map((r) => ({ id: r.id, status: r.status, reason: r.reason })),
    results,
    steps: results,
    controlEvidence: [],
    categories: Object.fromEntries(
      ["repo_runtime", "live_deployment", "local_production_env"].map((category) => [
        category,
        results.some((r) => r.category === category)
          ? assessment(
              results.filter((r) => r.category === category),
              flags.has("--dry-run")
            )
          : "UNAVAILABLE",
      ])
    ),
    inventory: CHECKS,
    evidenceLocations: results.flatMap((r) => r.evidence),
  };
  const json = JSON.stringify(report, null, 2) + "\n";
  const md = `# ${mode} audit\n\nRun: ${runId}\n\nAssessment: ${verdict}\n\n${argumentError || ""}\n\n${results.map((r) => `- ${r.status}: ${r.command}${r.reason ? ` — ${r.reason}` : ""}`).join("\n")}\n`;
  const base =
    mode === "payments" ? "payment-audit" : mode === "kyc" ? "kyc-audit" : `safety-${mode}`;
  for (const filename of [`${base}-${runId}.json`, `latest-${mode}.json`, "latest.json"])
    await writeFile(path.join(reportDir, filename), json);
  for (const filename of [`${base}-${runId}.md`, `latest-${mode}.md`, "latest.md"])
    await writeFile(path.join(reportDir, filename), md);
  const blockerJson = JSON.stringify(
    {
      mode,
      verdict,
      totalBlockers: blockers.length,
      blockers,
      reportJsonPath: path.join(reportDir, `${base}-${runId}.json`),
      generatedAt: report.finishedAt,
    },
    null,
    2
  );
  for (const name of [`${base}-blockers-${runId}`, `latest-${mode}-blockers`, "latest-blockers"]) {
    await writeFile(path.join(reportDir, `${name}.json`), blockerJson);
    await writeFile(
      path.join(reportDir, `${name}.txt`),
      `mode=${mode}\nverdict=${verdict}\ntotal_blockers=${blockers.length}\nblockers=${blockers.join(",")}\n`
    );
  }
  process.stdout.write(
    `${mode}: ${verdict}; ${report.stepsExecuted}/${report.stepsPlanned} executed. Evidence: ${reportDir}/latest.json\n`
  );
  if (["FAIL", "INCOMPLETE"].includes(verdict)) process.exitCode = 1;
}
