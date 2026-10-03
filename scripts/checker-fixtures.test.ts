import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm, cp, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pnpmInvocation } from "./lib/audit-runtime";
const root = process.cwd();
async function fixture(run: (directory: string) => Promise<void>) {
  const base = path.join(root, "tmp");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, "audit-fixture-"));
  try {
    await run(dir);
  } finally {
    if (!path.resolve(dir).startsWith(path.resolve(base) + path.sep + "audit-fixture-"))
      throw new Error("Unsafe fixture cleanup");
    await rm(dir, { recursive: true, force: true });
  }
}
function pnpm(args: string[]) {
  const [command, invocation] = pnpmInvocation(
    args.map((arg) => (process.platform === "win32" && /[\s()]/.test(arg) ? `"${arg}"` : arg))
  );
  return spawnSync(command, invocation, { cwd: root, encoding: "utf8", timeout: 120_000 });
}
test("required audit baselines and license notice are included in Git checkouts", () => {
  const files = [
    "scripts/audit-baselines/lint.json",
    "scripts/audit-baselines/format.json",
    "scripts/audit-baselines/duplication.json",
    "public/vendor/ffmpeg-core/NOTICE.txt",
    "scripts/license-reviews/remotion.json",
    "scripts/license-reviews/sentry-cli.json",
    "patches/braces@3.0.3.patch",
    "patches/braces@3.0.3.review.json",
  ];
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", ...files], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(tracked.status, 0, tracked.stderr);
  const ignored = spawnSync("git", ["check-ignore", "--no-index", ...files], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(ignored.status, 1, `Required files are ignored: ${ignored.stdout}${ignored.stderr}`);
});
test("Cloudflare build hook sanitizes cached artifacts and blocks failed secret scans", async () =>
  fixture(async (dir) => {
    await mkdir(path.join(dir, "scripts"));
    await cp(
      path.join(root, "scripts/ensure-opennext-build.mjs"),
      path.join(dir, "scripts/hook.mjs")
    );
    await mkdir(path.join(dir, ".open-next/assets"), { recursive: true });
    await mkdir(path.join(dir, ".open-next/cloudflare"), { recursive: true });
    await writeFile(path.join(dir, ".open-next/worker.js"), "export default {};");
    const envModule = path.join(dir, ".open-next/cloudflare/next-env.mjs");
    const source = ["production", "development", "test"]
      .map(
        (mode) =>
          `export const ${mode} = ${JSON.stringify({ PRIVATE_SETTING: "fixture-sensitive", NEXT_PUBLIC_APP_URL: "https://fixture.example" })};`
      )
      .join("\n");
    await writeFile(envModule, source);
    await writeFile(
      path.join(dir, "scan.cjs"),
      "const fs = require('node:fs'); if (fs.readFileSync('.open-next/cloudflare/next-env.mjs', 'utf8').includes('fixture-sensitive')) process.exit(1); fs.writeFileSync('scanned', 'yes'); process.exit(process.env.VM_FIXTURE_SCAN_FAILURE === '1' ? 1 : 0);"
    );
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "audit-hook-fixture",
        private: true,
        scripts: {
          "sanitize:cloudflare-env": `node --import tsx "${path.join(root, "scripts/sanitize-cloudflare-env.ts").replace(/\\/g, "/")}"`,
          "secret-scan:strict": "node scan.cjs",
          "build:cloudflare": 'node -e "process.exit(99)"',
        },
      })
    );
    const run = (failure = false) =>
      spawnSync(process.execPath, [path.join(dir, "scripts/hook.mjs")], {
        cwd: dir,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, VM_FIXTURE_SCAN_FAILURE: failure ? "1" : "0" },
      });
    const good = run();
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert(!(await readFile(envModule, "utf8")).includes("fixture-sensitive"));
    assert.equal(await readFile(path.join(dir, "scanned"), "utf8"), "yes");
    assert.equal(run(true).status, 1);
    await writeFile(envModule, "malformed export");
    assert.equal(run().status, 1);
  }));
test("Knip detects an unused export then accepts its removal", async () =>
  fixture(async (dir) => {
    await writeFile(path.join(dir, "package.json"), '{"name":"audit-fixture","private":true}');
    await writeFile(path.join(dir, "entry.ts"), "export const unusedAuditFixture = 42;\n");
    const config = path.join(dir, "knip.json");
    await writeFile(
      config,
      JSON.stringify({
        entry: ["entry.ts"],
        project: ["*.ts"],
        includeEntryExports: true,
      })
    );
    const bad = pnpm([
      "exec",
      "knip",
      "--directory",
      dir,
      "--config",
      config,
      "--include",
      "exports",
      "--no-progress",
      "--no-gitignore",
    ]);
    assert.notEqual(bad.status, 0, bad.stdout + bad.stderr);
    assert((bad.stdout + bad.stderr).includes("unusedAuditFixture"));
    await writeFile(path.join(dir, "entry.ts"), 'console.warn("corrected fixture");\n');
    const good = pnpm([
      "exec",
      "knip",
      "--directory",
      dir,
      "--config",
      config,
      "--include",
      "exports",
      "--no-progress",
      "--no-gitignore",
    ]);
    assert.equal(good.status, 0, good.stdout + good.stderr);
  }));
test("import checker detects a cycle then accepts corrected imports", async () =>
  fixture(async (dir) => {
    await writeFile(
      path.join(dir, "a.js"),
      'import { b } from "./b.js"; export const a = () => b;'
    );
    await writeFile(
      path.join(dir, "b.js"),
      'import { a } from "./a.js"; export const b = () => a;'
    );
    const config = path.join(dir, "cruiser.cjs");
    await writeFile(
      config,
      'module.exports={forbidden:[{name:"fixture-cycle",severity:"error",from:{},to:{circular:true}}]};'
    );
    const bad = pnpm(["exec", "depcruise", "--config", config, dir]);
    assert.notEqual(bad.status, 0, bad.stdout + bad.stderr);
    assert((bad.stdout + bad.stderr).includes("fixture-cycle"));
    await writeFile(path.join(dir, "b.js"), "export const b = 1;");
    const good = pnpm(["exec", "depcruise", "--config", config, dir]);
    assert.equal(good.status, 0, good.stdout + good.stderr);
  }));
test("jscpd detects duplicated executable code then accepts corrected fixture", async () =>
  fixture(async (dir) => {
    const lines = Array.from({ length: 25 }, (_, i) => `  value += input * ${i + 1};`).join("\n");
    const code = `export function fixture(input) {\n let value = 0;\n${lines}\nreturn value;\n}\n`;
    await writeFile(path.join(dir, "a.js"), code);
    await writeFile(path.join(dir, "b.js"), code);
    const config = path.join(dir, "jscpd.json");
    await writeFile(
      config,
      JSON.stringify({
        threshold: 0,
        minTokens: 20,
        minLines: 4,
        reporters: ["console"],
        gitignore: false,
      })
    );
    const bad = pnpm([
      "exec",
      "jscpd",
      "--config",
      config,
      "--no-gitignore",
      dir.replace(/\\/g, "/"),
    ]);
    assert.notEqual(bad.status, 0, bad.stdout + bad.stderr);
    assert((bad.stdout + bad.stderr).includes("clone"));
    await writeFile(path.join(dir, "b.js"), 'export const corrected = "unique";');
    const good = pnpm([
      "exec",
      "jscpd",
      "--config",
      config,
      "--no-gitignore",
      dir.replace(/\\/g, "/"),
    ]);
    assert.equal(good.status, 0, good.stdout + good.stderr);
  }));
test("bundle checker rejects missing chunks and malformed manifests then accepts corrected output", async () =>
  fixture(async (dir) => {
    const chunks = path.join(dir, ".next/static/chunks");
    await mkdir(chunks, { recursive: true });
    const manifest = path.join(dir, ".next/build-manifest.json");
    await writeFile(
      manifest,
      JSON.stringify({ pages: { "/fixture": ["static/chunks/fixture.js"] } })
    );
    const run = () =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", path.join(root, "scripts/check-bundle-budget.ts")],
        { cwd: dir, encoding: "utf8", timeout: 30000 }
      );
    assert.notEqual(run().status, 0);
    await writeFile(path.join(chunks, "fixture.js"), "console.warn('safe synthetic fixture');");
    assert.equal(run().status, 0);
    await writeFile(manifest, "malformed JSON");
    assert.notEqual(run().status, 0);
    await writeFile(
      manifest,
      JSON.stringify({ pages: { "/fixture": ["static/chunks/fixture.js"] } })
    );
    assert.equal(run().status, 0);
  }));
