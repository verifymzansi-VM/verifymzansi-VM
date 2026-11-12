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

const REASON_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;

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

const startsLiteral = (sql, i) =>
  sql[i] === "'" ||
  ((sql[i] === "E" || sql[i] === "e") && sql[i + 1] === "'" && !/[\w$]/.test(sql[i - 1] ?? ""));

/**
 * The SQL text with comments blanked and string contents replaced by "x", at
 * the same length, so searches for keywords, `;` and parentheses see code only.
 */
function maskSql(sql) {
  let out = "";
  for (let i = 0; i < sql.length;) {
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const next = sql.indexOf("\n", i);
      const end = next < 0 ? sql.length : next;
      out += " ".repeat(end - i);
      i = end;
    } else if (sql[i] === "/" && sql[i + 1] === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") (depth++, (j += 2));
        else if (sql[j] === "*" && sql[j + 1] === "/") (depth--, (j += 2));
        else j++;
      }
      out += sql.slice(i, j).replace(/[^\n]/g, " ");
      i = j;
    } else if (sql[i] === "$" && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(i, i + 64))) {
      // Dollar-quoted strings are text, except the function body itself
      // ($function$, as the snapshot writes it), which is code.
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64))[0];
      if (tag === "$function$") {
        out += tag;
        i += tag.length;
        continue;
      }
      const close = sql.indexOf(tag, i + tag.length);
      if (close < 0) throw new Error("Unterminated dollar-quoted string");
      const end = close + tag.length;
      out += tag + sql.slice(i + tag.length, close).replace(/[^\n]/g, "x") + tag;
      i = end;
    } else if (startsLiteral(sql, i)) {
      const prefix = sql[i] === "'" ? 1 : 2;
      const { end } = readLiteral(sql, i);
      out += sql.slice(i, i + prefix) + "x".repeat(end - i - prefix - 1) + "'";
      i = end;
    } else out += sql[i++];
  }
  return out;
}

/** Index of the `;` that ends the statement starting at `index` (masked text). */
function statementEnd(masked, index) {
  let depth = 0;
  for (let i = index; i < masked.length; i++) {
    if (masked[i] === "(") depth++;
    else if (masked[i] === ")") depth--;
    else if (masked[i] === ";" && depth === 0) return i;
  }
  throw new Error("Unterminated raise statement");
}

/** Splits a comma list at depth 0 (positions from the masked text). */
function splitTopLevel(text, masked) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === "(") depth++;
    else if (masked[i] === ")") depth--;
    else if (masked[i] === "," && depth === 0) {
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
  if (!startsLiteral(trimmed, 0)) return undefined;
  const literal = readLiteral(trimmed, 0);
  return trimmed.slice(literal.end).trim() === "" ? literal.value : undefined;
}

/**
 * Every `raise exception` statement in a SQL text (outside comments and
 * strings): its message literal (when the message is a plain literal) and its
 * USING options. Options whose value is not a single literal are reported as
 * `dynamic`. A raise this reader cannot follow (no level, a condition name, an
 * unexpected shape) is returned with `unreadable`, so the check fails rather
 * than miss a reason.
 */
export function parseRaiseStatements(sql) {
  const masked = maskSql(sql);
  const statements = [];
  for (const match of masked.matchAll(/\braise\b/gi)) {
    const afterRaise = match.index + match[0].length;
    const tail = masked.slice(afterRaise);
    if (/^\s*;/.test(tail)) continue; // re-raise inside an exception handler
    const level = /^\s*(exception|notice|warning|info|log|debug)\b/i.exec(tail);
    if (level && level[1].toLowerCase() !== "exception") continue;
    const start = afterRaise + (level ? level[0].length : 0);
    const end = statementEnd(masked, start);
    const text = sql.slice(start, end);
    const shape = masked.slice(start, end);
    const statement = { options: {}, dynamic: [] };
    if (!level) statement.unreadable = "raise without a level";
    let at = shape.search(/\S/);
    if (at < 0) at = shape.length;
    const usingAt = shape.slice(at).search(/\busing\b/i);
    const usingIndex = usingAt < 0 ? shape.length : at + usingAt;
    if (startsLiteral(shape, at)) {
      const literal = readLiteral(text, at);
      statement.message = literal.value;
      statement.formatted =
        text.slice(literal.end, usingIndex).trim().replace(/^,/, "").trim().length > 0;
    } else if (shape.slice(at, usingIndex).trim() !== "")
      statement.unreadable ??= `raise with a condition: ${text.slice(at, usingIndex).trim()}`;
    if (usingAt >= 0) {
      const optionsText = text.slice(usingIndex + 5);
      for (const option of splitTopLevel(optionsText, shape.slice(usingIndex + 5))) {
        const parsed = /^([a-z_]+)\s*=\s*([\s\S]+)$/i.exec(option);
        if (!parsed) {
          statement.unreadable ??= `unreadable option: ${option.slice(0, 80)}`;
          continue;
        }
        const name = parsed[1].toLowerCase();
        const value = literalValue(parsed[2]);
        if (value === undefined) statement.dynamic.push(name);
        else statement.options[name] = value;
      }
    }
    if (statement.message === undefined && statement.options.message !== undefined)
      statement.message = statement.options.message;
    statements.push(statement);
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
  const allMessages = new Set();
  const problems = [];
  for (const file of files) {
    const name = path.basename(path.dirname(file)) + "." + path.basename(file, ".sql");
    for (const statement of parseRaiseStatements(readFileSync(file, "utf8"))) {
      if (statement.unreadable) problems.push(`${name}: ${statement.unreadable}`);
      if (statement.message !== undefined) allMessages.add(statement.message);
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
  return { reasons, messages, allMessages, problems };
}

const BLOCK = /(\/\/ <database-reasons>[^\n]*\n)([\s\S]*?)(\n\/\/ <\/database-reasons>)/;
const ENTRY = /^\s*([a-z][a-z0-9_]*): \[((?:"[A-Z0-9]{5}"(?:, )?)*)\],$/;

/**
 * The shared list as written in src/lib/foundation/error-reasons.ts: the
 * generated reason block (reason -> codes, in file order) and the listed
 * messages.
 */
function parseSharedList(source) {
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
  const staffBlock = /export const STAFF_SECOND_FACTOR_MESSAGES = \[([\s\S]*?)\] as const;/.exec(
    source
  );
  if (!staffBlock) throw new Error("The shared list has no STAFF_SECOND_FACTOR_MESSAGES");
  // The pattern itself is compared with these messages by
  // src/lib/foundation/error-reasons.test.ts (it imports the real pattern).
  const staffSecondFactor = [...staffBlock[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(([, text]) =>
    JSON.parse(`"${text}"`)
  );
  return { reasons, messages, staffSecondFactor };
}

/**
 * Compares the database with the shared list. Returns human-readable failures
 * (empty when they agree).
 */
function compareReasons(database, shared) {
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
  for (const message of shared.staffSecondFactor ?? [])
    if (!database.allMessages.has(message))
      failures.push(
        `STAFF_SECOND_FACTOR_MESSAGES lists "${message}", which no current database function raises`
      );
  for (const [key, message] of Object.entries(shared.messages))
    if (!database.messages.has(message))
      failures.push(
        `The shared message ${key} ("${message}") is no longer raised by any current database function`
      );
  return failures;
}

/** The shared list's generated block for these database reasons. */
function renderReasonBlock(database) {
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
function writeReasonBlock(source, database) {
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

// `error.message === "<a message the database raises>"` and the reverse.
const MESSAGE_COMPARISON =
  /\.message\s*[!=]==?\s*"((?:[^"\x5c]|\x5c.)*)"|"((?:[^"\x5c]|\x5c.)*)"\s*[!=]==?\s*[\w$.?]*\.message\b/g;
/**
 * Raw comparisons left on purpose, by file, until the change that rewrites the
 * file lands; their messages are in FOUNDATION_ERROR_MESSAGES, so a reworded
 * message still fails the check.
 */
const MESSAGE_COMPARISONS_PENDING = new Map([
  // Rewritten by the open retired-backend removal; switch to hasDatabaseMessage then.
  [
    "src/app/api/admin/governance/roles/route.ts",
    ["owner-approved administrator invitation required"],
  ],
]);

/**
 * Lines in website code that compare an error's `message` with a string the
 * database raises, instead of using the shared list.
 */
export function findRawMessageComparisons(files, databaseMessages) {
  const found = [];
  for (const [file, text] of files)
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(MESSAGE_COMPARISON)) {
        const message = JSON.parse(`"${match[1] ?? match[2]}"`);
        if (!databaseMessages.has(message)) continue;
        if (MESSAGE_COMPARISONS_PENDING.get(file)?.includes(message)) continue;
        found.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  return found;
}

// `error.code === "PT409" && hasDatabaseReason(error, "x")`: a code paired by
// hand with a reason must be one the database raises that reason with.
const CODE_REASON_PAIR =
  /\.code\s*===\s*"([A-Z0-9]{5})"\s*&&\s*hasDatabaseReason\([^,()]+,\s*"([a-z0-9_]+)"\)/g;

/**
 * Lines in website code that pair a reason with a SQLSTATE the database does
 * not raise it with (after a code change in the database, for example).
 * `reasonCodes` maps each listed reason to its codes.
 */
export function findStaleCodePairs(files, reasonCodes) {
  const found = [];
  for (const [file, text] of files)
    text.split("\n").forEach((line, index) => {
      for (const [, code, reason] of line.matchAll(CODE_REASON_PAIR))
        if (!(reasonCodes.get(reason) ?? []).includes(code))
          found.push(`${file}:${index + 1}: '${reason}' is not raised with ${code}`);
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
  const reasonCodes = new Map(
    [...database.reasons].map(([reason, { codes }]) => [reason, [...codes]])
  );
  for (const line of findStaleCodePairs(code, reasonCodes))
    failures.push(`Code paired with a reason the database raises differently: ${line}`);
  for (const line of findRawMessageComparisons(code, database.allMessages))
    failures.push(`Match database messages with hasDatabaseMessage: ${line}`);
  for (const line of findRawReasonComparisons(code))
    failures.push(
      `Match database reasons with hasDatabaseReason or lookupDatabaseReason (src/lib/foundation/error-reasons.ts): ${line}`
    );
  return { failures, reasons: database.reasons.size };
}
