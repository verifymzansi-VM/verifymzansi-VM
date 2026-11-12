import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execute, pnpmInvocation } from "./lib/audit-runtime";
import { copyWorkingTreeSnapshot } from "./lib/working-tree-snapshot";
import { scenariosFromReport } from "./lib/browser-report-scenarios";
import { missingBuiltRoutes } from "./lib/built-routes.mjs";
async function main() {
  if (process.argv.length > 2) throw new Error("test:browser:isolated accepts no flags");
  const root = process.cwd();
  const output = path.join(root, "tmp/isolated-browser");
  await mkdir(output, { recursive: true });
  const checkout = await mkdtemp(path.join(output, "checkout-"));
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 120_000 });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
    return result.stdout;
  };
  const commit = git(["rev-parse", "HEAD"]).trim();
  // Use an ordinary build directory. There is no Git checkout, branch or
  // worktree here, and ignored credentials are excluded from the copy.
  await copyWorkingTreeSnapshot(root, checkout, git);
  if (git(["rev-parse", "HEAD"]).trim() !== commit)
    throw new Error("The source commit changed while copying the browser fixture");
  // The production build below still needs Playwright, TypeScript and the
  // contract generator. Do not let inherited production settings omit them.
  const [pnpm, installArgs] = pnpmInvocation([
    "install",
    "--frozen-lockfile",
    "--prefer-offline",
    "--prod=false",
  ]);
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !/SECRET|TOKEN|API_KEY|ACCESS_KEY|SERVICE_ROLE|ENCRYPTION_KEY|DATABASE_URL|SUPABASE_|GITHUB_|OZOW_|R2_|SENTRY_|RESEND_|AFRICASTALKING_/i.test(
            key
          )
      )
    ),
    SENTRY_AUTH_TOKEN: "",
    GIT_CEILING_DIRECTORIES: output,
    NODE_OPTIONS: "--max-old-space-size=4096",
    NODE_ENV: "production",
    // This lane exercises the source fixtures, independent of the caller's
    // eventual London build selection. Native foundation proofs run separately.
    NEXT_PUBLIC_DATA_BACKEND: "source",
    PLAYWRIGHT_HOST: "127.0.0.1",
    PLAYWRIGHT_PORT: "3197",
    PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3197",
    PLAYWRIGHT_REUSE_SERVER: "0",
    // The explicit build step below must pass before browser startup. Keeping
    // its output separate preserves diagnostics even before a reporter starts.
    PLAYWRIGHT_SKIP_BUILD: "1",
    PLAYWRIGHT_DEV_SERVER: "0",
    PLAYWRIGHT_CAPTURE_SERVER_OUTPUT: "1",
    CI: "1",
    PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS: "1200000",
  };
  const results: Array<{
    command: string;
    status: string;
    exitCode: number | null;
    durationMs: number;
    evidence: string;
  }> = [];
  for (const [label, args, timeout] of [
    ["install", installArgs, 600_000],
    [
      "build",
      pnpmInvocation(["exec", "node", "scripts/start-playwright-server.cjs", "--build-only"])[1],
      1_200_000,
    ],
    [
      "browser",
      pnpmInvocation([
        "exec",
        "playwright",
        "test",
        "e2e/smoke.spec.ts",
        "e2e/auth-recovery-readiness.spec.ts",
        "e2e/posting-guidance.spec.ts",
        "e2e/immersive-viewer.spec.ts",
        "e2e/addon-checkout.spec.ts",
        "e2e/dsar.spec.ts",
        "--project=chromium",
        "--project=mobile-chrome",
        "--reporter=json",
      ])[1],
      1_800_000,
    ],
    ["bundle", pnpmInvocation(["check:bundle-budget"])[1], 120_000],
  ] as const) {
    const result = await execute(pnpm, [...args], timeout, env, checkout);
    const log = path.join(output, `${path.basename(checkout)}-${label}.log`);
    await writeFile(log, result.output);
    results.push({
      command: label,
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      evidence: log,
    });
    if (result.status !== "PASS") break;
    if (label === "browser") {
      const match = result.output.match(/\{\s*"config"[\s\S]*$/);
      const browserReport = match ? JSON.parse(match[0]) : null;
      if (!browserReport?.stats || !browserReport.stats.expected)
        throw new Error("Empty or malformed browser execution report");
      await writeFile(
        path.join(output, `${path.basename(checkout)}-playwright.json`),
        JSON.stringify(browserReport, null, 2)
      );
      const scenarios = scenariosFromReport(browserReport);
      const uncoveredSkips = scenarios.filter(
        (scenario) =>
          scenario.status === "skipped" &&
          !scenarios.some((other) => other.key === scenario.key && other.status === "expected")
      );
      if (uncoveredSkips.length > 0) {
        results.push({
          command: "skipped browser scenarios",
          status: "UNAVAILABLE",
          exitCode: 2,
          durationMs: 0,
          evidence: log,
        });
      }
      const manifest = JSON.parse(
        await readFile(path.join(checkout, ".next/server/app-paths-manifest.json"), "utf8")
      );
      const missing = missingBuiltRoutes(manifest);
      if (missing.length > 0) throw new Error(`Built route missing: ${missing.join(", ")}`);
      results.push({
        command: "generated route manifest",
        status: "PASS",
        exitCode: 0,
        durationMs: 0,
        evidence: path.join(checkout, ".next/server/app-paths-manifest.json"),
      });
    }
  }
  // Keep the isolated source snapshot and browser artifacts as evidence.
  const pkg = JSON.parse(await readFile(path.join(checkout, "package.json"), "utf8"));
  await writeFile(
    path.join(output, "latest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        checkout,
        commit,
        snapshot: "working tree without ignored secrets",
        next: pkg.dependencies.next,
        results,
        quarantine: ["webkit", "mobile-safari"],
        providerVerification: false,
        limitations: [
          "KYC browser tests cover synthetic ID/selfie submission, evidence authorization, claims, resubmission, final approval/retention and independent high-risk governance UI. Auth/database/storage models do not attest real PostgreSQL RLS/transactions or genuine provider behavior.",
        ],
      },
      null,
      2
    )
  );
  process.stdout.write(`Isolated browser evidence: ${output}/latest.json\n`);
  if (results.some((r) => r.status !== "PASS"))
    process.exitCode = results.some((r) => r.status === "FAIL") ? 1 : 2;
}
main().catch((error) => {
  console.error(error);
  void mkdir("tmp/isolated-browser", { recursive: true }).then(() =>
    writeFile(
      "tmp/isolated-browser/latest.json",
      JSON.stringify(
        {
          schemaVersion: 1,
          assessment: "FAIL",
          reason: String(error),
          providerVerification: false,
        },
        null,
        2
      )
    )
  );
  process.exitCode = 1;
});
