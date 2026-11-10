// Safe order for database changes (expand, then contract).
//
// Three checks share this module:
// - the applied register at the end of database/foundation/updates/README.md
//   must name every update file with a pending or applied status;
// - the API manifests of a pull request are compared with its base commit, and
//   a removed or renamed command or argument (or another change that breaks
//   existing callers) fails unless contract-steps.json records it as the second
//   step of an earlier, applied expand update;
// - the release preflight compares what production answers (read-only, with
//   the publishable key) with the updates this commit expects.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { probeFoundationRuntimeApi } from "./foundation-runtime-api.mjs";

export const UPDATES_DIR = "database/foundation/updates";
export const UPDATES_README = `${UPDATES_DIR}/README.md`;
export const CONTRACT_STEPS = "database/foundation/contract-steps.json";
export const FINGERPRINT = "database/foundation/fingerprint.json";
export const API_MANIFESTS = [
  "database/foundation/api-manifest.json",
  "database/foundation/runtime-api-manifest.json",
];

const UPDATE_FILE = /^\d{14}_[a-z0-9_]+\.sql$/;
const REGISTER_START = "<!-- applied-register:start -->";
const REGISTER_END = "<!-- applied-register:end -->";
const STATUS_FORMS = [
  { kind: "pending", pattern: /^pending$/ },
  { kind: "applied", pattern: /^applied (\d{4}-\d{2}-\d{2}) \d{2}:\d{2} UTC$/ },
  { kind: "applied", pattern: /^applied (\d{4}-\d{2}-\d{2}) \(SAST date, time not recorded\)$/ },
  {
    kind: "applied",
    pattern: /^applied before (\d{4}-\d{2}-\d{2}) \d{2}:\d{2} UTC \(exact time not recorded\)$/,
  },
];
const CHANGES = new Set([
  "remove",
  "remove-argument",
  "argument-type",
  "require-argument",
  "returns",
  "revoke",
]);
const ROLES = ["anon", "authenticated", "service_role"];

/** Update file names in this folder, in the order the replay applies them. */
export function listUpdateFiles(root = process.cwd()) {
  return readdirSync(path.join(root, UPDATES_DIR))
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

/** Parses the applied register (a marked list at the end of the README). */
export function parseUpdateRegister(readme) {
  const start = readme.indexOf(REGISTER_START);
  const end = readme.indexOf(REGISTER_END);
  if (start === -1 || end === -1 || end < start)
    return { rows: [], errors: ["updates/README.md has no applied register markers"] };
  const items = [];
  for (const line of readme.slice(start + REGISTER_START.length, end).split(/\r?\n/)) {
    if (line.startsWith("- ")) items.push(line.slice(2));
    else if (/^\s+\S/.test(line) && items.length > 0) items[items.length - 1] += ` ${line.trim()}`;
    else if (line.trim() !== "") items.push(`unparsed: ${line.trim()}`);
  }
  const rows = [];
  const errors = [];
  for (const item of items) {
    const match = /^`([^`]+)`: ([^;]+?)(?:; (.+))?$/.exec(item);
    if (!match) {
      errors.push(`register line is not "- \`<file>\`: <status>; <evidence>": ${item}`);
      continue;
    }
    const [, file, status, evidence] = match;
    const form = STATUS_FORMS.find(({ pattern }) => pattern.test(status));
    if (!form) {
      errors.push(`${file}: unknown status "${status}"`);
      continue;
    }
    rows.push({
      file,
      status,
      kind: form.kind,
      date: form.pattern.exec(status)[1] ?? null,
      evidence: evidence ?? "",
    });
  }
  return { rows, errors };
}

/** Every update file has exactly one register row, in filename order, and the
 * register agrees with the production record in fingerprint.json. */
export function checkUpdateRegister({ files, rows, fingerprint }) {
  const errors = [];
  const listed = rows.map((row) => row.file);
  const fileSet = new Set(files);
  for (const file of files) {
    if (!UPDATE_FILE.test(file)) errors.push(`${file}: name is not <UTC timestamp>_<name>.sql`);
    if (!listed.includes(file))
      errors.push(
        `${file}: missing from the applied register; add "- \`${file}\`: pending" to updates/README.md`
      );
  }
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.file)) errors.push(`${row.file}: listed twice in the applied register`);
    seen.add(row.file);
    if (!fileSet.has(row.file)) errors.push(`${row.file}: in the register but not in updates/`);
    const fileDate = row.file.slice(0, 4) + "-" + row.file.slice(4, 6) + "-" + row.file.slice(6, 8);
    if (row.kind === "applied" && row.date < fileDate)
      errors.push(`${row.file}: applied date ${row.date} is before the file's own timestamp`);
    if (row.kind === "applied" && !row.evidence.trim())
      errors.push(`${row.file}: an applied row needs evidence after ";"`);
  }
  if (listed.join("\n") !== [...listed].sort().join("\n"))
    errors.push("the applied register is not in filename order");
  const check = fingerprint?.productionCheck ?? {};
  const pending = new Set(check.pendingApplication ?? []);
  const through = check.matchedThroughUpdate;
  if (through && !fileSet.has(through))
    errors.push(`fingerprint.json matchedThroughUpdate ${through} is not in updates/`);
  for (const row of rows) {
    if (row.kind === "pending" && !pending.has(row.file))
      errors.push(
        `${row.file}: pending in the register but not in fingerprint.json productionCheck.pendingApplication`
      );
    if (row.kind === "applied" && pending.has(row.file))
      errors.push(`${row.file}: applied in the register but listed in pendingApplication`);
    if (row.kind === "pending" && through && row.file <= through)
      errors.push(`${row.file}: pending, but production matched through ${through}`);
  }
  for (const file of pending)
    if (!rows.some((row) => row.file === file && row.kind === "pending"))
      errors.push(`${file}: in pendingApplication but not a pending register row`);
  return errors;
}

const byName = (manifests) => {
  const map = new Map();
  for (const manifest of manifests) for (const fn of manifest.functions) map.set(fn.name, fn);
  return map;
};
const signature = (fn) => fn.arguments.map((arg) => `${arg.name}:${arg.sqlType}`).join(",");

/** Changes between two API manifest sets that break callers written for the
 * base: removed or renamed commands and arguments, changed argument or return
 * types, newly required arguments and removed execute grants. Additions are
 * expand steps and are never reported. */
export function diffApiContracts(baseManifests, headManifests) {
  const base = byName(baseManifests);
  const head = byName(headManifests);
  const added = [...head.values()].filter((fn) => !base.has(fn.name));
  const findings = [];
  for (const [name, before] of base) {
    const after = head.get(name);
    if (!after) {
      const twin = added.find((fn) => signature(fn) === signature(before));
      findings.push({
        command: name,
        change: "remove",
        detail: twin
          ? `command ${name} removed; ${twin.name} with the same arguments was added in the same change (a rename)`
          : `command ${name} removed`,
      });
      continue;
    }
    const args = new Map(after.arguments.map((arg) => [arg.name, arg]));
    const oldArgs = new Map(before.arguments.map((arg) => [arg.name, arg]));
    for (const arg of before.arguments) {
      const now = args.get(arg.name);
      if (!now) {
        const twin = after.arguments.find(
          (candidate) => !oldArgs.has(candidate.name) && candidate.sqlType === arg.sqlType
        );
        findings.push({
          command: name,
          change: "remove-argument",
          argument: arg.name,
          detail: twin
            ? `${name}: argument ${arg.name} removed; ${twin.name} with the same type was added (a rename)`
            : `${name}: argument ${arg.name} removed`,
        });
      } else {
        if (now.sqlType !== arg.sqlType)
          findings.push({
            command: name,
            change: "argument-type",
            argument: arg.name,
            detail: `${name}: argument ${arg.name} changed from ${arg.sqlType} to ${now.sqlType}`,
          });
        if (arg.optional && !now.optional)
          findings.push({
            command: name,
            change: "require-argument",
            argument: arg.name,
            detail: `${name}: argument ${arg.name} became required`,
          });
      }
    }
    for (const arg of after.arguments)
      if (!oldArgs.has(arg.name) && !arg.optional)
        findings.push({
          command: name,
          change: "require-argument",
          argument: arg.name,
          detail: `${name}: new required argument ${arg.name}`,
        });
    if (before.returns !== after.returns)
      findings.push({
        command: name,
        change: "returns",
        detail: `${name}: return type changed from ${before.returns} to ${after.returns}`,
      });
    for (const role of ROLES)
      if (before.execute?.[role] && !after.execute?.[role])
        findings.push({
          command: name,
          change: "revoke",
          role,
          detail: `${name}: execute removed from ${role}`,
        });
  }
  return findings;
}

const stepKey = (item) =>
  [item.command, item.change, item.argument ?? "", item.role ?? ""].join("|");

/** Validates contract-steps.json on its own. */
export function parseContractSteps(document) {
  const errors = [];
  if (!document || document.schemaVersion !== 1 || !Array.isArray(document.steps))
    return { steps: [], errors: ["contract-steps.json needs schemaVersion 1 and a steps array"] };
  const keys = new Set();
  document.steps.forEach((step, index) => {
    const at = `contract-steps.json steps[${index}]`;
    if (!step || typeof step !== "object") return errors.push(`${at}: not an object`);
    if (typeof step.command !== "string" || !/^[a-z][a-z0-9_]{0,79}$/.test(step.command))
      errors.push(`${at}: command must be an API function name`);
    if (!CHANGES.has(step.change))
      errors.push(`${at}: change must be one of ${[...CHANGES].join(", ")}`);
    const needsArgument = ["remove-argument", "argument-type", "require-argument"].includes(
      step.change
    );
    if (needsArgument !== (typeof step.argument === "string"))
      errors.push(`${at}: argument is required exactly for argument changes`);
    if ((step.change === "revoke") !== ROLES.includes(step.role))
      errors.push(`${at}: role (${ROLES.join(", ")}) is required exactly for revoke`);
    if (
      step.replacement !== undefined &&
      (!["remove", "remove-argument"].includes(step.change) || typeof step.replacement !== "string")
    )
      errors.push(`${at}: replacement is only for remove or remove-argument`);
    if (typeof step.expandUpdate !== "string" || !UPDATE_FILE.test(step.expandUpdate))
      errors.push(`${at}: expandUpdate must name the earlier update file`);
    if (!Number.isInteger(step.expandPullRequest) || step.expandPullRequest < 1)
      errors.push(`${at}: expandPullRequest must be the earlier pull request number`);
    if (typeof step.reason !== "string" || step.reason.trim().length < 10)
      errors.push(`${at}: reason must explain why callers are safe`);
    const key = stepKey(step);
    if (keys.has(key)) errors.push(`${at}: duplicate step for ${key}`);
    keys.add(key);
  });
  return { steps: errors.length ? [] : document.steps, errors };
}

/** Each breaking finding needs a recorded second step whose expand update was
 * merged before (present on the base commit) and applied to production, and
 * whose replacement (for a rename) already existed on the base commit. */
export function checkContractSteps({
  findings,
  steps,
  baseUpdateFiles,
  rows,
  baseManifests,
  headManifests,
  references = () => [],
}) {
  const errors = [];
  const base = byName(baseManifests);
  const head = byName(headManifests);
  const applied = new Set(rows.filter((row) => row.kind === "applied").map((row) => row.file));
  const recorded = new Map(steps.map((step) => [stepKey(step), step]));
  for (const finding of findings) {
    const step = recorded.get(stepKey(finding));
    const hint =
      'Expand first: add the new command or argument in one pull request, switch the code, and remove the old one in a later pull request with an entry in database/foundation/contract-steps.json (see "Safe order" in updates/README.md).';
    if (!step) {
      errors.push(`${finding.detail}, without a recorded second step. ${hint}`);
      continue;
    }
    if (!baseUpdateFiles.includes(step.expandUpdate))
      errors.push(
        `${finding.detail}: expand update ${step.expandUpdate} is not on the base commit; the expand step must merge in an earlier pull request`
      );
    if (!applied.has(step.expandUpdate))
      errors.push(
        `${finding.detail}: expand update ${step.expandUpdate} is not recorded as applied in the register`
      );
    if (step.replacement !== undefined) {
      if (finding.change === "remove") {
        if (!base.has(step.replacement) || !head.has(step.replacement))
          errors.push(
            `${finding.detail}: replacement ${step.replacement} must already exist on the base commit and stay`
          );
      } else {
        const has = (map) =>
          map.get(finding.command)?.arguments.some((arg) => arg.name === step.replacement);
        if (!has(base) || !has(head))
          errors.push(
            `${finding.detail}: replacement argument ${step.replacement} must already exist on the base commit and stay`
          );
      }
    }
    if (finding.change === "remove") {
      const files = references(finding.command);
      if (files.length)
        errors.push(
          `${finding.detail}: the code still names it in ${files.join(", ")}; switch the code first`
        );
    }
  }
  return errors;
}

/** The update that first created each runtime command (its earliest update). */
export function introducingUpdates(runtimeManifest) {
  const map = new Map();
  for (const fn of runtimeManifest.functions) {
    const first = [...(fn.updates ?? [])].sort()[0];
    if (!first) continue;
    const file = first.replace(/^updates\//, "");
    map.set(file, [...(map.get(file) ?? []), fn.name]);
  }
  return map;
}

/**
 * Compares the database with the updates this commit expects.
 * @param {object} input
 * @param {string[]} input.files update files in this commit
 * @param {{file: string, kind: string}[]} [input.rows] register rows (production only)
 * @param {object} input.runtimeManifest runtime-api-manifest.json
 * @param {{name: string, state: string}[]} input.probes live probe results
 * @param {string[]} [input.removedFiles] update files deleted from this commit's history
 */
export function updateDrift({ files, rows = [], runtimeManifest, probes, removedFiles = [] }) {
  const introduced = introducingUpdates(runtimeManifest);
  const state = new Map(probes.map((probe) => [probe.name, probe.state]));
  const commands = (file) => introduced.get(file) ?? [];
  const pending = new Set(rows.filter((row) => row.kind === "pending").map((row) => row.file));
  const recorded = new Set(rows.map((row) => row.file));
  const liveMissing = files.filter((file) =>
    commands(file).some((name) => state.get(name) === "missing")
  );
  const livePresent = files.filter(
    (file) =>
      commands(file).length > 0 && commands(file).every((name) => state.get(name) === "present")
  );
  const behind = files.filter(
    (file) =>
      liveMissing.includes(file) ||
      ((pending.has(file) || (rows.length > 0 && !recorded.has(file))) &&
        !livePresent.includes(file))
  );
  const unrecorded = files.filter((file) => pending.has(file) && livePresent.includes(file));
  const ahead = removedFiles.filter((file) => !files.includes(file));
  const unexpected = probes.filter((probe) => probe.state === "unexpected").map((p) => p.name);
  const unobservable = files.filter((file) => commands(file).length === 0);
  return { behind, ahead, unrecorded, unexpected, unobservable, expected: files.length };
}

/** Human-readable lines for updateDrift's result. */
export function describeUpdateDrift(drift, target) {
  const lines = [];
  const list = (files) =>
    files.length > 5 ? `${files.slice(0, 5).join(", ")}, ...` : files.join(", ");
  if (drift.behind.length)
    lines.push({
      level: "warning",
      text: `${target} database behind by ${drift.behind.length}: ${list(drift.behind)}`,
    });
  if (drift.ahead.length)
    lines.push({
      level: "warning",
      text: `${target} database ahead by ${drift.ahead.length}: ${list(drift.ahead)} (removed from the repository after merge; a code rollback does not undo a database update)`,
    });
  if (drift.unrecorded.length)
    lines.push({
      level: "warning",
      text: `${target} database has ${drift.unrecorded.length} update(s) the register still lists as pending: ${list(drift.unrecorded)}; record the applied time in database/foundation/updates/README.md`,
    });
  if (drift.unexpected.length)
    lines.push({
      level: "warning",
      text: `${target} database: ${drift.unexpected.length} command(s) answered unexpectedly: ${list(drift.unexpected)}`,
    });
  if (!drift.behind.length && !drift.ahead.length)
    lines.push({
      level: "notice",
      text: `${target} database in step with this commit's ${drift.expected} updates`,
    });
  lines.push({
    level: "notice",
    text: `${drift.unobservable.length} of ${drift.expected} updates change no API command the publishable key can see; their state comes from the applied register`,
  });
  return lines;
}

export function readJsonFile(root, file) {
  return JSON.parse(readFileSync(path.join(root, file), "utf8"));
}

/** Update files that this commit's history added and later deleted (for
 * example by reverting a merged pull request). A database keeps them. */
export function removedUpdateFiles(root = process.cwd(), git = defaultGit) {
  const output = git(root, [
    "log",
    "--no-renames",
    "--diff-filter=D",
    "--name-only",
    "--format=",
    "HEAD",
    "--",
    UPDATES_DIR,
  ]);
  return [
    ...new Set(
      output
        .split(/\r?\n/)
        .map((line) => line.trim().split("/").pop())
        .filter((file) => file && UPDATE_FILE.test(file))
    ),
  ];
}
function defaultGit(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
}

/**
 * Read-only comparison of a hosted database with the updates this commit
 * expects. Only the publishable key is sent (anonymous RPC probes).
 * @param {{url: string, publishableKey: string}} connection
 * @param {object} [options]
 * @param {string} [options.target] label used in messages
 * @param {boolean} [options.recorded] use the applied register (production)
 * @param {typeof fetch} [options.fetcher]
 * @param {string} [options.root]
 * @param {string[]} [options.removedFiles] defaults to this commit's git history
 */
export async function readFoundationUpdateDrift(connection, options = {}) {
  const { target = "production", recorded = true, fetcher = fetch, root = process.cwd() } = options;
  const files = listUpdateFiles(root);
  const rows = recorded
    ? parseUpdateRegister(readFileSync(path.join(root, UPDATES_README), "utf8")).rows
    : [];
  const runtimeManifest = readJsonFile(root, API_MANIFESTS[1]);
  const probes = await probeFoundationRuntimeApi(connection, fetcher, runtimeManifest);
  const notes = [];
  let removedFiles = options.removedFiles;
  if (!removedFiles) {
    try {
      removedFiles = removedUpdateFiles(root);
    } catch {
      removedFiles = [];
      notes.push({
        level: "notice",
        text: "git history unavailable; reverted updates not checked",
      });
    }
  }
  const drift = updateDrift({ files, rows, runtimeManifest, probes, removedFiles });
  return { drift, lines: [...describeUpdateDrift(drift, target), ...notes] };
}

/** Prints describeUpdateDrift lines, as annotations inside GitHub Actions. */
export function printUpdateDrift(lines, log = console.log) {
  const actions = process.env.GITHUB_ACTIONS === "true";
  for (const { level, text } of lines) log(actions ? `::${level}::${text}` : `${level}: ${text}`);
}
