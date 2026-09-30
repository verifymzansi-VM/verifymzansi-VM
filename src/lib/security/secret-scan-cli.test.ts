// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("scans unstaged source, excludes local credentials, and fails on Git errors", () => {
  const root = process.cwd();
  const temporaryRoot = path.join(root, "tmp");
  mkdirSync(temporaryRoot, { recursive: true });
  const directory = mkdtempSync(path.join(temporaryRoot, "secret-scan-tests-"));
  const scan = (cwd = directory, env = process.env) =>
    spawnSync(
      process.execPath,
      [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "scripts/secret-scan.ts")],
      { cwd, env, encoding: "utf8" }
    );
  try {
    expect(spawnSync("git", ["init", "--quiet"], { cwd: directory }).status).toBe(0);
    const syntheticSecret = ["sb", "secret", "X".repeat(25)].join("_");
    writeFileSync(path.join(directory, ".gitignore"), ".env\n");
    writeFileSync(path.join(directory, ".env"), syntheticSecret);
    expect(scan().status).toBe(0);
    writeFileSync(path.join(directory, "new-source.txt"), syntheticSecret);
    const detected = scan();
    expect(detected.status).toBe(1);
    expect(detected.stderr).toContain("new-source.txt:1 [Supabase secret key]");
    expect(detected.stderr).not.toContain(syntheticSecret);
    unlinkSync(path.join(directory, "new-source.txt"));
    const failedGit = scan(directory, { ...process.env, GIT_DIR: path.join(directory, "missing") });
    expect(failedGit.status).toBe(1);
    expect(failedGit.stderr).toContain("Failed to run git ls-files");
  } finally {
    const resolvedDirectory = realpathSync(directory);
    if (
      !resolvedDirectory.startsWith(realpathSync(temporaryRoot) + path.sep + "secret-scan-tests-")
    ) {
      throw new Error("Unexpected secret scan test directory");
    }
    rmSync(resolvedDirectory, { recursive: true, force: true });
  }
}, 30_000);
