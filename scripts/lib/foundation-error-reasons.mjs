// The error reasons the live database raises, read from the generated current
// schema (database/foundation/current/functions, rewritten by
// `pnpm db:foundation:snapshot` and checked fresh in CI), and compared with the
// shared list the website imports (src/lib/foundation/error-reasons.ts).
//
// A reason is the literal `detail` of a `raise exception ... using detail = '...'`
// statement. Renaming one in a database update changes the snapshot, so the
// shared list no longer matches and the check fails until the list (and every
// caller, which the TypeScript types then flag) is updated.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const REASON_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;
const START_PATTERN = /raise\s+exception\b/iy;

/** Reads a SQL string literal ('...' with '' escapes, or E'...') at `index`. */
function readLiteral(sql, index) {
  let i = index;
  const escaped = sql[i] === "E" || sql[i] === "e";
  if (escaped) i++;
  if (sql[i] !== "'") return null;
  let value = "";
  for (i++; i < sql.length; i++) {
    const char = sql[i];
    if (escaped && char === "\\") {
      value += sql[i + 1];
      i++;
    } else if (char === "'") {
      if (sql[i + 1] === "'") {
        value += "'";
        i++;
      } else return { value, end: i + 1 };
    } else value += char;
  }
  throw new Error("Unterminated SQL string literal");
}

/** Index just after the `;` that ends the statement starting at `index`. */
function statementEnd(sql, index) {
  let depth = 0;
  for (let i = index; i < sql.length; i++) {
    const char = sql[i];
    if (char === "'" || ((char === "E" || char === "e") && sql[i + 1] === "'")) {
      i = readLiteral(sql, i).end - 1;
    } else if (char === "-" && sql[i + 1] === "-") {
      i = sql.indexOf("\n", i);
      if (i < 0) break;
    } else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === ";" && depth === 0) return i + 1;
  }
  throw new Error("Unterminated raise statement");
}

/** Splits a comma list at depth 0, outside literals. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "'" || ((char === "E" || char === "e") && text[i + 1] === "'"))
      i = readLiteral(text, i).end - 1;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** The whole expression is one string literal: its value; otherwise undefined. */
function literalValue(expression) {
  const trimmed = expression.trim();
  if (!/^[Ee]?'/.test(trimmed)) return undefined;
  const literal = readLiteral(trimmed, 0);
  return trimmed.slice(literal.end).trim() === "" ? literal.value : undefined;
}

/** Skips whitespace and `--` comments. */
function skipSpace(sql, index) {
  let i = index;
  for (;;) {
    while (i < sql.length && /\s/.test(sql[i])) i++;
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const next = sql.indexOf("\n", i);
      i = next < 0 ? sql.length : next;
    } else return i;
  }
}

/**
 * Every `raise exception` statement in a SQL text: its message literal (when
 * the message is a plain literal) and its USING options. Options whose value
 * is not a single literal are reported as `dynamic`.
 */
export function parseRaiseStatements(sql) {
  const statements = [];
  let index = 0;
  for (;;) {
    const found = sql.slice(index).search(/raise\s+exception\b/i);
    if (found < 0) break;
    const start = index + found;
    // Skip text inside comments and string literals before the match.
    const lineStart = sql.lastIndexOf("\n", start) + 1;
    if (sql.slice(lineStart, start).includes("--")) {
      index = start + 1;
      continue;
    }
    START_PATTERN.lastIndex = start;
    START_PATTERN.exec(sql);
    const end = statementEnd(sql, START_PATTERN.lastIndex);
    const body = sql.slice(START_PATTERN.lastIndex, end - 1);
    const statement = { message: undefined, options: {}, dynamic: [] };
    let rest = body;
    const messageAt = skipSpace(rest, 0);
    if (/^[Ee]?'/.test(rest.slice(messageAt))) {
      const literal = readLiteral(rest, messageAt);
      const afterMessage = rest.slice(literal.end);
      const usingMatch = /\busing\b/i.exec(afterMessage);
      const formatArgs = (usingMatch ? afterMessage.slice(0, usingMatch.index) : afterMessage)
        .trim()
        .replace(/^,/, "")
        .trim();
      statement.message = literal.value;
      statement.formatted = formatArgs.length > 0;
      rest = usingMatch ? afterMessage.slice(usingMatch.index) : "";
    }
    const using = /^\s*using\b/i.exec(rest);
    if (using) {
      for (const option of splitTopLevel(rest.slice(using[0].length))) {
        const match = /^([a-z_]+)\s*=\s*([\s\S]+)$/i.exec(option);
        if (!match) throw new Error(`Unreadable raise option: ${option.slice(0, 80)}`);
        const name = match[1].toLowerCase();
        const value = literalValue(match[2]);
        if (value === undefined) statement.dynamic.push(name);
        else statement.options[name] = value;
      }
    }
    if (statement.message === undefined && statement.options.message !== undefined)
      statement.message = statement.options.message;
    statements.push(statement);
    index = end;
  }
  return statements;
}

/** Function files of the generated current schema, in a stable order. */
export function currentFunctionFiles(root) {
  const base = path.join(root, "database", "foundation", "current", "functions");
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((schema) =>
      readdirSync(path.join(base, schema.name))
        .filter((file) => file.endsWith(".sql"))
        .map((file) => path.join(base, schema.name, file))
    )
    .sort();
}

/**
 * Reasons (literal details, with the SQLSTATEs and functions that raise them)
 * and plain literal messages the current schema raises, plus problems that
 * would hide a reason from the shared list.
 */
export function readDatabaseReasons(files) {
  const reasons = new Map();
  const messages = new Set();
  const problems = [];
  for (const file of files) {
    const name = path.basename(path.dirname(file)) + "." + path.basename(file, ".sql");
    for (const statement of parseRaiseStatements(readFileSync(file, "utf8"))) {
      if (statement.message !== undefined && !statement.formatted) messages.add(statement.message);
      if (statement.dynamic.includes("detail"))
        problems.push(`${name}: detail is not a literal reason token`);
      const detail = statement.options.detail;
      if (detail === undefined || detail === "") continue;
      if (!REASON_PATTERN.test(detail)) {
        problems.push(`${name}: detail '${detail}' is not a reason token (a-z, 0-9, _)`);
        continue;
      }
      if (statement.dynamic.includes("errcode") || !statement.options.errcode) {
        problems.push(`${name}: reason '${detail}' is raised without a literal errcode`);
        continue;
      }
      if (!reasons.has(detail)) reasons.set(detail, { codes: new Set(), functions: new Set() });
      reasons.get(detail).codes.add(statement.options.errcode);
      reasons.get(detail).functions.add(name);
    }
  }
  return { reasons, messages, problems };
}

const BLOCK = /(\/\/ <database-reasons>[^\n]*\n)([\s\S]*?)(\n\/\/ <\/database-reasons>)/;
const ENTRY = /^\s*([a-z][a-z0-9_]*): \[((?:"[A-Z0-9]{5}"(?:, )?)*)\],$/;

/**
 * The shared list as written in src/lib/foundation/error-reasons.ts: the
 * generated reason block (reason -> codes, in file order) and the listed
 * messages.
 */
export function parseSharedList(source) {
  const block = BLOCK.exec(source);
  if (!block) throw new Error("The shared list has no <database-reasons> block");
  const lines = block[2].split("\n");
  if (
    lines[0] !== "export const FOUNDATION_ERROR_REASONS = {" ||
    lines.at(-1) !== "} as const satisfies Record<string, readonly string[]>;"
  )
    throw new Error("The shared list's generated block has an unexpected shape");
  const reasons = [];
  for (const line of lines.slice(1, -1)) {
    const entry = ENTRY.exec(line);
    if (!entry) throw new Error(`Unreadable shared list line: ${line.trim()}`);
    reasons.push([entry[1], entry[2] ? entry[2].split(", ").map((code) => code.slice(1, -1)) : []]);
  }
  const messageBlock = /export const FOUNDATION_ERROR_MESSAGES = \{([\s\S]*?)\} as const;/.exec(
    source
  );
  if (!messageBlock) throw new Error("The shared list has no FOUNDATION_ERROR_MESSAGES");
  const messages = Object.fromEntries(
    [...messageBlock[1].matchAll(/([A-Za-z][A-Za-z0-9]*):\s*"((?:[^"\\]|\\.)*)"/g)].map(
      ([, key, text]) => [key, JSON.parse(`"${text}"`)]
    )
  );
  return { reasons, messages };
}

/**
 * Compares the database with the shared list. Returns human-readable failures
 * (empty when they agree).
 */
export function compareReasons(database, shared) {
  const failures = [...database.problems];
  const listed = new Map(shared.reasons);
  if (listed.size !== shared.reasons.length) failures.push("The shared list repeats a reason");
  const names = shared.reasons.map(([reason]) => reason);
  if ([...names].sort().some((reason, i) => reason !== names[i]))
    failures.push("The shared list is not in alphabetical order");
  for (const [reason, { codes, functions }] of database.reasons) {
    if (!listed.has(reason)) {
      failures.push(
        `The database raises '${reason}' (${[...functions].join(", ")}) but the shared list does not name it`
      );
      continue;
    }
    const expected = [...codes].sort().join(", ");
    const actual = [...listed.get(reason)].join(", ");
    if (expected !== actual)
      failures.push(
        `The database raises '${reason}' with code(s) ${expected}; the shared list says ${actual || "none"}`
      );
  }
  for (const reason of listed.keys())
    if (!database.reasons.has(reason))
      failures.push(
        `The shared list names '${reason}' but no current database function raises it (renamed or removed?)`
      );
  for (const [key, message] of Object.entries(shared.messages))
    if (!database.messages.has(message))
      failures.push(
        `The shared message ${key} ("${message}") is no longer raised by any current database function`
      );
  return failures;
}

/** The shared list's generated block for these database reasons. */
export function renderReasonBlock(database) {
  const entries = [...database.reasons.keys()].sort().map((reason) => {
    const codes = [...database.reasons.get(reason).codes].sort();
    return `  ${reason}: [${codes.map((code) => `"${code}"`).join(", ")}],`;
  });
  return [
    "export const FOUNDATION_ERROR_REASONS = {",
    ...entries,
    "} as const satisfies Record<string, readonly string[]>;",
  ].join("\n");
}

/** The shared list's source with its generated block replaced. */
export function writeReasonBlock(source, database) {
  if (!BLOCK.test(source)) throw new Error("The shared list has no <database-reasons> block");
  return source.replace(
    BLOCK,
    (_, open, _body, close) => open + renderReasonBlock(database) + close
  );
}

// `error.details === "x"`, `"x" !== err.details` and similar: database reasons
// matched by hand instead of through the shared list's helpers.
// `typeof x.details === "object"` checks a type, not a reason, and is allowed.
const RAW_COMPARISON =
  /(?<!typeof\s+[\w$.?]*)\.details\s*[!=]==?\s*["'`]|["'`][a-z0-9_]*["'`]\s*[!=]==?\s*(?!typeof\b)[\w$.?]*\.details\b/;

/**
 * Lines in website code that compare a database error's `details` with a
 * string literal. `files` maps a repository-relative path to its text.
 */
export function findRawReasonComparisons(files) {
  const found = [];
  for (const [file, text] of files)
    text.split("\n").forEach((line, index) => {
      if (RAW_COMPARISON.test(line)) found.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  return found;
}

const SHARED_LIST = "src/lib/foundation/error-reasons.ts";
const CODE_ROOTS = ["src", "workers"];

function codeFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "__tests__") walk(full);
      } else if (
        /\.(ts|tsx|mjs|js)$/.test(entry.name) &&
        !/\.(test|spec|stories)\.[a-z]+$/.test(entry.name) &&
        !entry.name.endsWith(".d.ts")
      )
        files.push(full);
    }
  };
  walk(path.join(root));
  return files;
}

/**
 * The whole check over a checkout: database reasons against the shared list,
 * and raw comparisons in website code. With `write`, the shared list's
 * generated block is rewritten from the database first.
 */
export function runReasonCheck({ root = process.cwd(), write = false } = {}) {
  const database = readDatabaseReasons(currentFunctionFiles(root));
  const listPath = path.join(root, SHARED_LIST);
  let source = readFileSync(listPath, "utf8");
  if (write) {
    const next = writeReasonBlock(source, database);
    if (next !== source) writeFileSync(listPath, next);
    source = next;
  }
  const failures = compareReasons(database, parseSharedList(source));
  const code = CODE_ROOTS.flatMap((dir) => codeFiles(path.join(root, dir))).map((file) => [
    path.relative(root, file).replaceAll("\\", "/"),
    readFileSync(file, "utf8"),
  ]);
  for (const line of findRawReasonComparisons(code))
    failures.push(
      `Match database reasons with hasDatabaseReason or lookupDatabaseReason (src/lib/foundation/error-reasons.ts): ${line}`
    );
  return { failures, reasons: database.reasons.size };
}
