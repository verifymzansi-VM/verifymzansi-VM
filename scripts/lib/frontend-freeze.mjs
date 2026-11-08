// Logic for `pnpm check:frontend-freeze` (roadmap M0.13). The owner chose the
// frontend of commit 0b562f42 (see FRONTEND-RESTORE.md). Every frontend file
// that differs from it must have a row in FRONTEND-CHANGES.md, and each row
// records the exact version of the file it describes, so a later edit to an
// already listed file is noticed too. See scripts/check-frontend-freeze.mjs.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const BASELINE_COMMIT = "0b562f42f96b5390c62244cb9e97b219da1471f4";
export const LEDGER_FILE = "FRONTEND-CHANGES.md";

// The restored scope from FRONTEND-RESTORE.md: the roadmap's comparison plus
// src/styles, which that document also names (it has no differences today).
export const FROZEN_PATHSPEC = [
  "src/components",
  "src/hooks",
  "src/stores",
  "src/styles",
  "public",
  "tailwind.config.ts",
  ":(glob)src/app/**/*.tsx",
  ":(glob)src/app/**/*.css",
  ":(glob)src/app/**/*.scss",
];

export const KINDS = ["rewiring", "wording-behaviour", "visual", "test", "helper"];
export const COLUMNS = [
  "File",
  "Kind",
  "Reason",
  "What changes on screen",
  "Proposed",
  "Owner decision",
  "Date",
  "Version",
];
export const LEDGER_START = "<!-- frontend-ledger:start -->";
export const LEDGER_END = "<!-- frontend-ledger:end -->";

const VERSION_LENGTH = 12;
const DELETED = "deleted";

function splitRow(line) {
  // Cells are separated by unescaped pipes; the leading and trailing pipes
  // produce empty first and last entries.
  const cells = [];
  let current = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "|" && line[index - 1] !== String.fromCharCode(92)) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells.slice(1, -1);
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/**
 * Reads the active rows between the ledger markers. Rows outside the markers
 * (for example the history of files that were put back) are not checked.
 * @param {string} text
 */
export function parseLedger(text) {
  const lines = text.split(/\r?\n/);
  const errors = [];
  const rows = [];
  const start = lines.findIndex((line) => line.trim() === LEDGER_START);
  const end = lines.findIndex((line) => line.trim() === LEDGER_END);
  if (start === -1 || end === -1 || end < start) {
    errors.push(
      `${LEDGER_FILE} needs the markers ${LEDGER_START} and ${LEDGER_END}, in that order`
    );
    return { rows, errors };
  }
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith("|")) continue;
    const cells = splitRow(line);
    if (isSeparatorRow(cells)) continue;
    if (cells[0] === COLUMNS[0]) {
      if (cells.join("|") !== COLUMNS.join("|")) {
        errors.push(`line ${index + 1}: table header must be | ${COLUMNS.join(" | ")} |`);
      }
      continue;
    }
    const lineNumber = index + 1;
    if (cells.length !== COLUMNS.length) {
      errors.push(`line ${lineNumber}: expected ${COLUMNS.length} cells, found ${cells.length}`);
      continue;
    }
    const match = /^`([^`]+)`$/.exec(cells[0]);
    if (!match) {
      errors.push(`line ${lineNumber}: the File cell must be one path in backticks`);
      continue;
    }
    const [, kind, reason, screen, proposed, decision, date, version] = cells;
    const row = {
      path: match[1],
      kind,
      reason,
      screen,
      proposed,
      decision,
      date,
      version,
      line: lineNumber,
    };
    if (!KINDS.includes(kind)) {
      errors.push(`line ${lineNumber}: kind "${kind}" is not one of ${KINDS.join(", ")}`);
    }
    for (const [name, value] of [
      ["Reason", reason],
      ["What changes on screen", screen],
      ["Owner decision", decision],
    ]) {
      if (!value) errors.push(`line ${lineNumber}: ${name} is empty`);
    }
    if (!/^(keep|put back)\b/i.test(proposed)) {
      errors.push(`line ${lineNumber}: Proposed must start with "keep" or "put back"`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      errors.push(`line ${lineNumber}: Date must be YYYY-MM-DD`);
    }
    if (version !== DELETED && !new RegExp(`^[0-9a-f]{${VERSION_LENGTH}}$`).test(version)) {
      errors.push(
        `line ${lineNumber}: Version must be the first ${VERSION_LENGTH} characters of the file's git blob id, or "${DELETED}"`
      );
    }
    rows.push(row);
  }
  return { rows, errors };
}

/**
 * Compares the ledger with the files that differ from the chosen version.
 * @param {Map<string, string>} differing path -> current version
 * @param {Array<{path: string, version: string, line: number}>} rows
 */
export function compareLedger(differing, rows) {
  const seen = new Map();
  const duplicates = [];
  for (const row of rows) {
    if (seen.has(row.path)) duplicates.push(row);
    else seen.set(row.path, row);
  }
  const missing = [...differing.keys()].filter((file) => !seen.has(file)).sort();
  const stale = [...seen.values()].filter((row) => !differing.has(row.path));
  const changed = [...seen.values()].filter(
    (row) => differing.has(row.path) && differing.get(row.path) !== row.version
  );
  return { missing, stale, changed, duplicates };
}

/**
 * Rewrites the Version cell of rows whose file still differs. Rows are not
 * added or removed: those need a person to write the reason and kind.
 * @param {string} text
 * @param {Map<string, string>} differing
 */
export function refreshVersions(text, differing) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === LEDGER_START);
  const end = lines.findIndex((line) => line.trim() === LEDGER_END);
  const updated = [];
  for (let index = start + 1; start !== -1 && index < end; index += 1) {
    const line = lines[index];
    if (!line.trim().startsWith("|")) continue;
    const cells = splitRow(line.trim());
    const match = cells.length === COLUMNS.length ? /^`([^`]+)`$/.exec(cells[0]) : null;
    if (!match || !differing.has(match[1])) continue;
    const next = differing.get(match[1]);
    const current = cells[COLUMNS.length - 1];
    if (current === next) continue;
    const cut = line.lastIndexOf(current);
    lines[index] = `${line.slice(0, cut)}${next}${line.slice(cut + current.length)}`;
    updated.push(match[1]);
  }
  return { text: lines.join(newline), updated };
}

function git(cwd, args, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 << 20,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function hasCommit(cwd, commit) {
  try {
    git(cwd, ["cat-file", "-e", `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes sure the chosen commit is present. CI checks out one commit only, so
 * the baseline is fetched by id (it is part of main's history on GitHub).
 * @param {{cwd: string, commit?: string, fetch?: boolean, remote?: string}} options
 */
export function ensureBaseline({ cwd, commit = BASELINE_COMMIT, fetch = true, remote = "origin" }) {
  if (hasCommit(cwd, commit)) return { fetched: false };
  if (!fetch) {
    throw new Error(`Commit ${commit} is not in this clone; run: git fetch ${remote} ${commit}`);
  }
  const shallow = git(cwd, ["rev-parse", "--is-shallow-repository"]).trim() === "true";
  const args = ["fetch", "--no-tags", "--quiet", ...(shallow ? ["--depth=1"] : []), remote, commit];
  try {
    git(cwd, args);
  } catch (error) {
    throw new Error(
      `Could not fetch the chosen frontend commit ${commit} from ${remote}: ${String(error.stderr || error.message).trim()}`
    );
  }
  if (!hasCommit(cwd, commit)) throw new Error(`Commit ${commit} is still missing after fetching`);
  return { fetched: true };
}

function lines(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Files in the restored scope that differ from the chosen commit: the
 * roadmap's `git diff --name-only` (working tree, renames split into a delete
 * and an add) plus untracked files that are not ignored.
 * @param {{cwd: string, commit?: string}} options
 */
export function differingPaths({ cwd, commit = BASELINE_COMMIT }) {
  const changed = lines(
    git(cwd, [
      "diff",
      "--name-only",
      "--no-renames",
      "--no-ext-diff",
      commit,
      "--",
      ...FROZEN_PATHSPEC,
    ])
  );
  const untracked = lines(
    git(cwd, ["ls-files", "--others", "--exclude-standard", "--", ...FROZEN_PATHSPEC])
  );
  return [...new Set([...changed, ...untracked])].sort();
}

/**
 * Short git blob id of each file as it is now (line endings normalised the
 * same way git stores them), or "deleted".
 * @param {{cwd: string, paths: string[]}} options
 */
export function currentVersions({ cwd, paths }) {
  const versions = new Map();
  const present = paths.filter((file) => existsSync(path.join(cwd, file)));
  for (const file of paths) if (!present.includes(file)) versions.set(file, DELETED);
  for (let offset = 0; offset < present.length; offset += 200) {
    const batch = present.slice(offset, offset + 200);
    const ids = lines(git(cwd, ["hash-object", "--", ...batch]));
    if (ids.length !== batch.length)
      throw new Error("git hash-object returned an unexpected count");
    batch.forEach((file, index) => versions.set(file, ids[index].slice(0, VERSION_LENGTH)));
  }
  return versions;
}
