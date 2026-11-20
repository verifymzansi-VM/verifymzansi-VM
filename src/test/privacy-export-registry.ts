import { readFileSync } from "node:fs";

/**
 * Reads the dataset names of the access export registry from the committed
 * snapshot of internal.frontend_privacy_export_data, for tests.
 *
 * The SQL is tokenised (comments, quoted strings, dollar-quoted strings and
 * words), not matched with a line pattern, so formatting, comments and SQL
 * text inside the statements cannot add or hide a name. The registry must have
 * the shape
 *   from (values ('<name>', $q$<statement>$q$), ...) as registry(dataset, statement)
 * and any other shape throws, so a reshaped registry fails the test instead of
 * being read wrongly.
 */
export const PRIVACY_EXPORT_SNAPSHOT =
  "database/foundation/current/functions/internal/frontend_privacy_export_data.sql";

type Token =
  | { kind: "string"; value: string }
  | { kind: "dollar"; value: string }
  | { kind: "word"; value: string }
  | { kind: "symbol"; value: string };

/** Splits SQL into tokens; comments and whitespace are dropped. */
export function tokenizeSql(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    const ch = sql[i];
    if (/\s/.test(ch)) {
      i += 1;
    } else if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
    } else if (rest.startsWith("/*")) {
      // Postgres block comments nest.
      let depth = 0;
      do {
        if (sql.startsWith("/*", i)) {
          depth += 1;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth -= 1;
          i += 2;
        } else if (i >= sql.length) {
          throw new Error("Unterminated block comment");
        } else {
          i += 1;
        }
      } while (depth > 0);
    } else if (ch === "'") {
      const escaped = /[eE]$/.test(sql.slice(0, i)) && !/[A-Za-z0-9_][eE]$/.test(sql.slice(0, i));
      let value = "";
      i += 1;
      for (;;) {
        if (i >= sql.length) throw new Error("Unterminated string literal");
        if (escaped && sql[i] === "\\") {
          value += sql.slice(i, i + 2);
          i += 2;
        } else if (sql[i] === "'" && sql[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (sql[i] === "'") {
          i += 1;
          break;
        } else {
          value += sql[i];
          i += 1;
        }
      }
      if (escaped && tokens.at(-1)?.kind === "word") tokens.pop();
      tokens.push({ kind: "string", value });
    } else if (ch === "$" && /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.test(rest)) {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest)![0];
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) throw new Error(`Unterminated ${tag} string`);
      tokens.push({ kind: "dollar", value: sql.slice(i + tag.length, end) });
      i = end + tag.length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(rest)![0];
      tokens.push({ kind: "word", value: word.toLowerCase() });
      i += word.length;
    } else {
      tokens.push({ kind: "symbol", value: ch });
      i += 1;
    }
  }
  return tokens;
}

const isWord = (token: Token | undefined, value: string) =>
  token?.kind === "word" && token.value === value;
const isSymbol = (token: Token | undefined, value: string) =>
  token?.kind === "symbol" && token.value === value;

/** The dataset names of the registry in a function definition, in order. */
export function registryDatasetNames(definition: string): string[] {
  const outer = tokenizeSql(definition);
  const as = outer.findIndex(
    (token, index) => isWord(token, "as") && outer[index + 1]?.kind === "dollar"
  );
  if (as === -1) throw new Error("No function body found");
  const body = tokenizeSql(outer[as + 1].value);
  const starts = body
    .map((_, index) => index)
    .filter(
      (index) =>
        isWord(body[index], "from") &&
        isSymbol(body[index + 1], "(") &&
        isWord(body[index + 2], "values")
    );
  if (starts.length !== 1) throw new Error(`Expected one registry, found ${starts.length}`);
  let index = starts[0] + 3;
  const names: string[] = [];
  for (;;) {
    const [open, name, comma, statement, close] = body.slice(index, index + 5);
    if (
      !isSymbol(open, "(") ||
      name?.kind !== "string" ||
      !isSymbol(comma, ",") ||
      statement?.kind !== "dollar" ||
      !isSymbol(close, ")")
    )
      throw new Error(`Registry entry ${names.length + 1} is not ('<name>', $q$<statement>$q$)`);
    names.push(name.value);
    index += 5;
    if (isSymbol(body[index], ",")) {
      index += 1;
      continue;
    }
    break;
  }
  const tail = body.slice(index, index + 8).map((token) => token.value);
  if (tail.join(" ") !== ") as registry ( dataset , statement )")
    throw new Error(
      `Registry does not end with "as registry(dataset,statement)": ${tail.join(" ")}`
    );
  return names;
}

/** The dataset names of the committed snapshot's registry, in order. */
export function snapshotDatasetNames(path = PRIVACY_EXPORT_SNAPSHOT): string[] {
  return registryDatasetNames(readFileSync(path, "utf8"));
}
