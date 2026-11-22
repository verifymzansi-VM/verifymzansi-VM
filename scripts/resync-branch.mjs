#!/usr/bin/env node
// Brings a pull request branch up to date with main and refreshes the files
// that database/foundation/README.md says are generated from the replay.
//
//   node scripts/resync-branch.mjs
//
// 1. Merges origin/main into the current branch (after fetching it). On any
//    conflict it stops, lists the conflicted files and leaves the merge in
//    progress for you to resolve. It never resolves anything itself.
// 2. Regenerates the replay outputs: the fingerprint
//    (pnpm db:foundation:replay -- --write) and the readable snapshot
//    (pnpm db:foundation:snapshot), then checks the API manifests and runtime
//    types (pnpm db:foundation:api-check) and the API contracts
//    (node scripts/check-foundation-api-contracts.mjs).
// 3. Runs the safe-order check against main
//    (node scripts/check-foundation-update-order.mjs --base origin/main) and
//    the frontend freeze check (node scripts/check-frontend-freeze.mjs).
//
// It commits nothing after the merge: review the regenerated files with
// `git status` and `git diff`, then commit them yourself. It never pushes.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.length > 0) {
  console.error(`Unsupported argument: ${args.join(" ")}\nUsage: node scripts/resync-branch.mjs`);
  process.exit(2);
}

function git(gitArgs, { allowFailure = false } = {}) {
  const result = spawnSync("git", gitArgs, { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    process.stderr.write(result.stdout + result.stderr);
    stop(`git ${gitArgs.join(" ")} failed.`);
  }
  return result;
}

function stop(message) {
  console.error(`\nStopped: ${message}`);
  process.exit(1);
}

// Runs a repository script with this Node binary, never through a shell.
function step(title, script, scriptArgs = []) {
  console.log(`\n== ${title}\n$ node ${[script, ...scriptArgs].join(" ")}`);
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    stop(`${title} failed (exit ${result.status}). Fix it, then run this script again.`);
}

const root = git(["rev-parse", "--show-toplevel"]).stdout.trim();
process.chdir(root);

const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true });
if (branch.status !== 0) stop("HEAD is detached. Check out your pull request branch first.");
const name = branch.stdout.trim();
if (name === "main") stop("you are on main. Run this on a pull request branch, never on main.");

const gitDir = git(["rev-parse", "--git-dir"]).stdout.trim();
if (existsSync(path.resolve(gitDir, "MERGE_HEAD")))
  stop(
    "a merge is already in progress. Finish it (resolve, git add, git commit) or run git merge --abort, then run this script again."
  );

// Only tracked changes matter: untracked files never block a merge here.
const dirty = git(["status", "--porcelain", "--untracked-files=no"]).stdout.trim();
if (dirty) stop(`the branch has uncommitted changes. Commit or stash them first:\n${dirty}`);

console.log(`== Merging origin/main into ${name}`);
git(["fetch", "--no-tags", "origin", "main"]);
const merge = git(["merge", "--no-edit", "origin/main"], { allowFailure: true });
process.stdout.write(merge.stdout);
if (merge.status !== 0) {
  const conflicted = git(["diff", "--name-only", "--diff-filter=U"], { allowFailure: true })
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
  if (conflicted.length === 0) {
    process.stderr.write(merge.stderr);
    stop("git merge origin/main failed without listing conflicts (see the message above).");
  }
  console.error("\nThe merge has conflicts. Resolve these files by hand:");
  for (const file of conflicted) console.error(`  ${file}`);
  console.error(
    [
      "",
      "Nothing was resolved for you, and the merge is still in progress.",
      "For each file: edit it, then `git add <file>`. When all are added: `git commit`.",
      "Generated files (database/foundation/fingerprint.json, database/foundation/current/,",
      "the API manifests and types) can take either side: this script regenerates them",
      "when you run it again after committing the merge.",
      "To give up instead: git merge --abort",
    ].join("\n")
  );
  process.exit(1);
}

// The commands behind the package.json scripts named in database/foundation/
// README.md, run with node directly (no shell): pnpm db:foundation:replay --
// --write, pnpm db:foundation:snapshot and pnpm db:foundation:api-check.
step("Record the replay fingerprint", "scripts/replay-foundation-schema.mjs", ["--write"]);
step("Regenerate the readable schema snapshot", "scripts/generate-foundation-snapshot.mjs");
step("Check the API manifests and runtime types", "scripts/check-foundation-api-drift.mjs");
step("Check the API contracts", "scripts/check-foundation-api-contracts.mjs");
step(
  "Check the update register and API removals against main",
  "scripts/check-foundation-update-order.mjs",
  ["--base", "origin/main"]
);
step("Check the frontend freeze ledger", "scripts/check-frontend-freeze.mjs");

const changed = git(["status", "--porcelain"]).stdout.trim();
console.log(
  changed
    ? `\nDone. Review and commit what changed:\n${changed}`
    : "\nDone. Nothing to commit: the generated files were already current."
);
