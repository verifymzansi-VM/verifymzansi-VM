// Pure scanning and ratchet logic for `pnpm check:legacy-surface` (roadmap
// M0.11). Production runs the foundation backend; this measures how much
// application code still reaches for the retired ("source") backend, so the
// committed baseline can only go down. See scripts/check-legacy-surface.mjs.
import path from "node:path";

/** Application code that is scanned: production sources, never tests. */
const SCAN_ROOTS = ["src", "workers"];
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const NOT_PRODUCTION = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|\/__tests__\/|^src\/test\/|\.d\.ts$)/;

/** The three retired client factories (`@/lib/supabase/{admin,server,client}`). */
const LEGACY_CLIENT_MODULES = [
  "src/lib/supabase/admin",
  "src/lib/supabase/server",
  "src/lib/supabase/client",
];

// Receivers whose `.from("...")` is not a table read (Storage buckets, typed
// array, iterator and stream helpers).
const NON_TABLE_RECEIVERS = new Set([
  "storage",
  "Array",
  "Buffer",
  "Iterator",
  "Readable",
  "ReadableStream",
  "Duplex",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
]);

// Quote characters: ' " and the backtick (written as \x60 so no parser sees a
// template literal inside a regular expression).
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\1/g;
const LITERAL_RPC = /\.rpc\s*(?:<[^>()]*>)?\(\s*(["'\x60])([A-Za-z0-9_]+)\1/g;
const DYNAMIC_RPC = /\.rpc\s*(?:<[^>()]*>)?\(\s*[^"'\x60\s)]/;
const STRING_NAME = /(["'\x60])([a-z][a-z0-9_]*)\1/g;
const TABLE_READ = /(\w+)?\s*\.from\s*(?:<[^>()]*>)?\(\s*(["'\x60])([A-Za-z0-9_]+)\2/g;
// A table named through an UPPER_SNAKE string constant instead of a literal:
// `const PROFILE_TABLE = "account_profiles"` (const, let or var, optionally
// exported, with any one-line type annotation, or an alias of another such
// constant), read as `.from(PROFILE_TABLE)`, `.from(PROFILE_TABLE as T)` or
// `.from(compat.PROFILE_TABLE)`. Lower-case variables stay unresolved (dynamic).
//
// Known limits (resolving them needs a TypeScript parser, not a regex):
// constants are matched by name, so a namespace qualifier is not tied to the
// module it imports and `TABLES.PROFILE` resolves only if some constant is
// itself named PROFILE; object and enum members, import or export renames
// (`import { PROFILE_TABLE as T }`), destructuring, lower-case copies
// (`const t = PROFILE_TABLE`) and computed names (template literals,
// concatenation) are not followed; and the receiver is only the word before
// `.from`, so a non-database helper reached through another name still counts.
// The legacy-surface tests pin these limits.
const TABLE_CONSTANT =
  /\b(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*(?::[^=;\n]+)?=\s*(?:(["'\x60])([a-z][a-z0-9_]*)\2|([A-Z][A-Z0-9_]*)\b(?!\s*[.([]))/g;
const CONSTANT_TABLE_READ =
  /(\w+)?\s*\.from\s*(?:<[^>()]*>)?\(\s*(\w+\.)?([A-Z][A-Z0-9_]*)\s*(?:as\s[^,)]*)?[,)]/g;
const BACKEND_SWITCH = /\bgetDataBackend\s*\(\s*\)/g;
const DEFINED_FUNCTION =
  /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\s*\.\s*)?"?([a-z0-9_]+)"?\s*\(/gi;

/** @param {string} file repository-relative path with forward slashes */
export function isScannedFile(file) {
  return (
    SCAN_ROOTS.some((root) => file.startsWith(`${root}/`)) &&
    SOURCE_FILE.test(file) &&
    !NOT_PRODUCTION.test(file)
  );
}

/**
 * Resolve an import specifier to a repository path without extension.
 * @param {string} file importing file
 * @param {string} specifier
 * @returns {string | null}
 */
export function resolveSpecifier(file, specifier) {
  let target;
  if (specifier.startsWith("@/")) target = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) target = path.posix.join(path.posix.dirname(file), specifier);
  else return null;
  return target.replace(/\.(?:[cm]?[jt]sx?)$/, "").replace(/\/index$/, "");
}

/**
 * Names of public functions the retired migration tree (supabase/migrations)
 * defines. Used only to resolve names passed to `.rpc(variable)` wrappers.
 * @param {string[]} sqlTexts
 */
export function definedFunctionNames(sqlTexts) {
  const names = new Set();
  for (const text of sqlTexts) {
    for (const match of text.matchAll(DEFINED_FUNCTION)) names.add(match[1].toLowerCase());
  }
  return names;
}

/**
 * String constants that name a table: per file, and across all files under
 * the key "". Aliases are resolved. A file's own definition wins over one
 * elsewhere; across files the first definition (in the given order) wins.
 * @param {{ path: string, text: string }[]} files
 * @returns {Map<string, Map<string, string>>}
 */
function tableConstantsOf(files) {
  /** @type {Map<string, Map<string, { value?: string, alias?: string }>>} */
  const raw = new Map([["", new Map()]]);
  const anywhere = /** @type {Map<string, { value?: string, alias?: string }>} */ (raw.get(""));
  for (const { path: file, text } of files) {
    const own = new Map();
    for (const match of text.matchAll(TABLE_CONSTANT)) {
      const entry = match[3] ? { value: match[3] } : { alias: match[4] };
      own.set(match[1], entry);
      if (!anywhere.has(match[1])) anywhere.set(match[1], entry);
    }
    if (own.size > 0) raw.set(file, own);
  }
  /** @type {Map<string, Map<string, string>>} */
  const resolved = new Map();
  for (const [file, own] of raw) {
    const values = new Map();
    for (const [name, first] of own) {
      let entry = first;
      // Follow aliases (own file first, then anywhere), a bounded number of hops.
      for (let hop = 0; entry && !entry.value && hop < 8; hop++) {
        const alias = /** @type {string} */ (entry.alias);
        entry = own.get(alias) ?? anywhere.get(alias);
      }
      if (entry?.value) values.set(name, entry.value);
    }
    resolved.set(file, values);
  }
  return resolved;
}

/**
 * @param {{ path: string, text: string }[]} files scanned production files
 * @param {{ apiNames: Set<string>, retiredFunctionNames: Set<string> }} names
 *   apiNames: every foundation `api` command (database/foundation manifests);
 *   retiredFunctionNames: functions the retired migration tree defines.
 */
export function measureLegacySurface(files, { apiNames, retiredFunctionNames }) {
  const tableConstants = tableConstantsOf(files);
  let backendSwitches = 0;
  let retiredCommandCalls = 0;
  let retiredTableReads = 0;
  const importers = new Set();
  const commandNames = new Set();
  const tableNames = new Set();
  /** @type {Record<string, Record<string, number>>} */
  const perFile = {};
  const bump = (file, key, by = 1) => {
    if (by === 0) return;
    perFile[file] ??= {};
    perFile[file][key] = (perFile[file][key] ?? 0) + by;
  };

  for (const { path: file, text } of files) {
    const switches = [...text.matchAll(BACKEND_SWITCH)].length;
    backendSwitches += switches;
    bump(file, "backendSwitches", switches);

    for (const match of text.matchAll(SPECIFIER)) {
      const target = resolveSpecifier(file, match[2]);
      if (target && LEGACY_CLIENT_MODULES.includes(target)) importers.add(file);
    }

    for (const match of text.matchAll(LITERAL_RPC)) {
      if (apiNames.has(match[2])) continue;
      commandNames.add(match[2]);
      retiredCommandCalls += 1;
      bump(file, "retiredCommandCalls");
    }
    // Wrappers that call `.rpc(name)` with a variable: resolve the retired
    // names they spell out as string literals.
    if (DYNAMIC_RPC.test(text)) {
      for (const match of text.matchAll(STRING_NAME)) {
        if (retiredFunctionNames.has(match[2]) && !apiNames.has(match[2])) {
          commandNames.add(match[2]);
        }
      }
    }

    for (const match of text.matchAll(TABLE_READ)) {
      if (match[1] && NON_TABLE_RECEIVERS.has(match[1])) continue;
      tableNames.add(match[3]);
      retiredTableReads += 1;
      bump(file, "retiredTableReads");
    }
    for (const match of text.matchAll(CONSTANT_TABLE_READ)) {
      if (match[1] && NON_TABLE_RECEIVERS.has(match[1])) continue;
      // A qualified name (`compat.X`) is defined elsewhere, not in this file.
      const own = match[2] ? undefined : tableConstants.get(file)?.get(match[3]);
      const table = own ?? tableConstants.get("")?.get(match[3]);
      if (!table) continue;
      tableNames.add(table);
      retiredTableReads += 1;
      bump(file, "retiredTableReads");
    }
  }

  return {
    counts: {
      backendSwitches,
      legacyClientImports: importers.size,
      retiredCommandNames: commandNames.size,
      retiredCommandCalls,
      retiredTableReads,
    },
    legacyClientImporters: [...importers].sort(),
    retiredCommandNames: [...commandNames].sort(),
    retiredTableNames: [...tableNames].sort(),
    perFile,
  };
}

/** Lists in the baseline whose members may only disappear. */
const RATCHETED_LISTS = /** @type {const} */ ([
  ["legacyClientImporters", "file importing a retired client"],
  ["retiredCommandNames", "retired command name"],
  ["retiredTableNames", "retired table name"],
]);

/**
 * Compare a measurement with the committed baseline.
 * `rises` fail the check (new legacy surface); `falls` also fail until the
 * baseline is lowered (`--update`), so the ratchet always moves down.
 * @param {ReturnType<typeof measureLegacySurface>} current
 * @param {{ counts: Record<string, number>, legacyClientImporters: string[], retiredCommandNames: string[], retiredTableNames: string[] }} baseline
 */
export function compareWithBaseline(current, baseline) {
  const rises = [];
  const falls = [];
  for (const [key, value] of Object.entries(current.counts)) {
    const allowed = baseline.counts?.[key];
    if (typeof allowed !== "number") {
      rises.push(`${key}: no baseline value (measured ${value})`);
    } else if (value > allowed) {
      rises.push(`${key} rose from ${allowed} to ${value}`);
    } else if (value < allowed) {
      falls.push(`${key} fell from ${allowed} to ${value}`);
    }
  }
  for (const [key, label] of RATCHETED_LISTS) {
    const allowed = new Set(baseline[key] ?? []);
    const found = new Set(current[key]);
    for (const item of found) if (!allowed.has(item)) rises.push(`new ${label}: ${item}`);
    for (const item of allowed) if (!found.has(item)) falls.push(`${label} gone: ${item}`);
  }
  return { rises, falls };
}

/**
 * The baseline written by `--update` (only after a check without rises).
 * @param {ReturnType<typeof measureLegacySurface>} current
 */
export function baselineFrom(current) {
  return {
    $comment:
      "Ratchet for pnpm check:legacy-surface (roadmap M0.11). Every value may only go down. Lower it with `pnpm check:legacy-surface --update` after removing old-backend code; raising any value needs a reviewed reason. legacyClientImporters is also the frozen import list read by .dependency-cruiser.cjs.",
    counts: current.counts,
    legacyClientImporters: current.legacyClientImporters,
    retiredCommandNames: current.retiredCommandNames,
    retiredTableNames: current.retiredTableNames,
  };
}

/**
 * Files with the most findings of one kind, to point at what grew.
 * @param {Record<string, Record<string, number>>} perFile
 * @param {string} key
 */
export function topFiles(perFile, key, limit = 5) {
  return Object.entries(perFile)
    .filter(([, counts]) => counts[key])
    .sort((a, b) => b[1][key] - a[1][key] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([file, counts]) => `${file} (${counts[key]})`);
}
