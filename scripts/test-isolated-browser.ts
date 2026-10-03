import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { execute, pnpmInvocation } from "./lib/audit-runtime";
async function main() {
  if (process.argv.length > 2) throw new Error("test:browser:isolated accepts no flags");
  const root = process.cwd();
  const output = path.join(root, "tmp/isolated-browser");
  await mkdir(output, { recursive: true });
  const checkout = await mkdtemp(path.join(output, "checkout-"));
  const git = (args: string[], cwd = root) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 120_000 });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
    return result.stdout;
  };
  git(["worktree", "add", "--detach", checkout, "HEAD"]);
  // Copy the authorized working snapshot without copying ignored credentials.
  const files = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    if (file.startsWith(".agents/skills/next-browser/")) continue;
    const target = path.resolve(checkout, file);
    if (!target.startsWith(checkout + path.sep)) throw new Error("Snapshot escaped checkout");
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await cp(path.join(root, file), target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await rm(target, { force: true }); // Reflect tracked deletions in the tested snapshot.
    }
  }
  const [pnpm, installArgs] = pnpmInvocation(["install", "--frozen-lockfile", "--prefer-offline"]);
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
    NODE_ENV: "production",
    PLAYWRIGHT_PORT: "3197",
    PLAYWRIGHT_REUSE_SERVER: "0",
    PLAYWRIGHT_SKIP_BUILD: "0",
    PLAYWRIGHT_DEV_SERVER: "0",
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
      "browser",
      pnpmInvocation([
        "exec",
        "playwright",
        "test",
        "e2e/smoke.spec.ts",
        "e2e/addon-checkout.spec.ts",
        "e2e/billing-payment-roundtrip.spec.ts",
        "e2e/kyc-verification.spec.ts",
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
      const scenarios: Array<{ key: string; status: string }> = [];
      type BrowserSuite = {
        specs?: Array<{
          file: string;
          line: number;
          title: string;
          tests?: Array<{ status: string }>;
        }>;
        suites?: BrowserSuite[];
      };
      const collect = (suites: BrowserSuite[]) => {
        for (const suite of suites) {
          for (const spec of suite.specs ?? []) {
            for (const test of spec.tests ?? [])
              scenarios.push({
                key: `${spec.file}:${spec.line}:${spec.title}`,
                status: test.status,
              });
          }
          collect(suite.suites ?? []);
        }
      };
      collect(browserReport.suites ?? []);
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
      for (const route of [
        "/api/webhooks/ozow/route",
        "/api/webhooks/kyc/provider/route",
        "/api/verification/session/start/route",
        "/pricing/page",
      ]) {
        if (!Object.keys(manifest).some((key) => key.endsWith(route)))
          throw new Error(`Built route missing: ${route}`);
      }
      results.push({
        command: "generated route manifest",
        status: "PASS",
        exitCode: 0,
        durationMs: 0,
        evidence: path.join(checkout, ".next/server/app-paths-manifest.json"),
      });
    }
  }
  // Keep the isolated checkout and browser artifacts as reviewable evidence.
  const pkg = JSON.parse(await readFile(path.join(checkout, "package.json"), "utf8"));
  await writeFile(
    path.join(output, "latest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        checkout,
        commit: git(["rev-parse", "HEAD"], checkout).trim(),
        snapshot: "working tree without ignored secrets",
        next: pkg.dependencies.next,
        results,
        quarantine: ["webkit", "mobile-safari"],
        providerVerification: false,
        limitations: [
          "KYC browser tests cover anonymous boundaries and callback validation; authenticated document submission and reviewer decisions require an expanded isolated fixture. Unit regressions cover these paths separately.",
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
