// CI gate for the safe order of database changes (foundation-replay job).
//
//   node scripts/check-foundation-update-order.mjs [--base <commit>]
//
// Offline: reads this checkout and, with --base, the base commit through git.
// 1. The applied register in database/foundation/updates/README.md names every
//    update file and agrees with fingerprint.json's production record.
// 2. With a base commit, the API manifests are compared with the base: a
//    removed or renamed command or argument (or another change that breaks
//    existing callers) needs a reviewed second step added to
//    contract-steps.json in this change. The expand update must be applied
//    according to the base commit's register, not this change's.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  API_MANIFESTS,
  CONTRACT_STEPS,
  FINGERPRINT,
  UPDATES_DIR,
  UPDATES_README,
  checkContractSteps,
  checkUpdateRegister,
  codeReferences,
  diffApiContracts,
  listUpdateFiles,
  parseContractSteps,
  parseUpdateRegister,
  readJsonFile,
} from "./lib/foundation-update-order.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
let base = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--base" && i + 1 < args.length) base = args[++i];
  else if (args[i].startsWith("--base=")) base = args[i].slice("--base=".length);
  else {
    console.error(`Unsupported argument: ${args[i]}`);
    process.exit(2);
  }
}
if (base && !/^[0-9a-f]{7,40}$|^[A-Za-z0-9._/-]{1,100}$/.test(base)) {
  console.error("The base must be a commit or branch name");
  process.exit(2);
}
if (/^0+$/.test(base)) base = "";

const root = process.cwd();
const git = (gitArgs) =>
  execFileSync("git", gitArgs, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64e6,
    stdio: ["ignore", "pipe", "pipe"],
  });

const errors = [];
const files = listUpdateFiles(root);
const register = parseUpdateRegister(readFileSync(path.join(root, UPDATES_README), "utf8"));
errors.push(...register.errors);
errors.push(
  ...checkUpdateRegister({
    files,
    rows: register.rows,
    fingerprint: readJsonFile(root, FINGERPRINT),
  })
);
const steps = parseContractSteps(readJsonFile(root, CONTRACT_STEPS));
errors.push(...steps.errors);

let compared = "no base commit given; API removals not compared";
if (base) {
  const commit = git(["rev-parse", "--verify", `${base}^{commit}`]).trim();
  const head = git(["rev-parse", "HEAD"]).trim();
  if (commit === head) compared = "base is HEAD; nothing to compare";
  else {
    const atBase = (file) => git(["show", `${commit}:${file}`]);
    const optionalAtBase = (file) => {
      try {
        return atBase(file);
      } catch {
        return null; // not on the base commit yet
      }
    };
    const baseManifests = API_MANIFESTS.map((file) => JSON.parse(atBase(file)));
    const headManifests = API_MANIFESTS.map((file) => readJsonFile(root, file));
    const baseUpdateFiles = git(["ls-tree", "--name-only", `${commit}:${UPDATES_DIR}`])
      .split(/\r?\n/)
      .filter((file) => file.endsWith(".sql"));
    const baseReadme = optionalAtBase(UPDATES_README);
    const baseStepsText = optionalAtBase(CONTRACT_STEPS);
    const findings = diffApiContracts(baseManifests, headManifests);
    errors.push(
      ...checkContractSteps({
        findings,
        steps: steps.steps,
        baseSteps: baseStepsText ? parseContractSteps(JSON.parse(baseStepsText)).steps : [],
        baseUpdateFiles,
        headUpdateFiles: files,
        baseRows: baseReadme ? parseUpdateRegister(baseReadme).rows : [],
        baseManifests,
        headManifests,
        references: (name) => codeReferences(name, git),
      })
    );
    compared = `${findings.length} caller-breaking API change(s) against ${commit.slice(0, 12)}`;
  }
}

if (errors.length) {
  for (const error of errors)
    console.error(process.env.GITHUB_ACTIONS === "true" ? `::error::${error}` : `FAIL ${error}`);
  console.error(`Database update order check failed (${errors.length} problem(s)).`);
  process.exit(1);
}
console.log(
  `PASS database update order: ${files.length} updates in the register; ${compared}; ${steps.steps.length} recorded second step(s).`
);
