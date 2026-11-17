import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * On Cloudflare (workerd) Next.js hands a route handler a JS Proxy around its
 * request. Building a new request from it (`new NextRequest(request)`) throws
 * "Invalid URL: [object Request]" before any error handling, so the route
 * answered a bare 500. Route handlers and the shared helpers they call pass
 * the request on unchanged.
 *
 * This is a source scan: Node does not reproduce the workerd failure (a Proxy
 * of a NextRequest is accepted here), so a behavioural test would pass against
 * the broken code too.
 */

const SRC_DIR = path.resolve(__dirname, "..");
const SKIPPED_DIRS = new Set(["__tests__", "node_modules"]);
const TEST_FILE = /\.(?:test|spec|stories)\.[cm]?[jt]sx?$/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const REQUEST_CONSTRUCTORS = new Set(["NextRequest", "Request"]);
/** A string-valued property: `new NextRequest(request.url, …)` builds from a URL. */
const URL_PROPERTY = /^(url|href)$/i;
/** A variable named like a URL holds a string or URL, not an incoming request. */
const URL_NAME = /(url|href)$/i;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(full);
    return SOURCE_FILE.test(entry.name) &&
      !TEST_FILE.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
      ? [full]
      : [];
  });
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  )
    current = current.expression;
  return current;
}

/** True when the first argument is an existing request rather than a URL. */
function rebuildsRequest(argument: ts.Expression): boolean {
  const node = unwrap(argument);
  if (ts.isIdentifier(node)) return !URL_NAME.test(node.text);
  if (ts.isPropertyAccessExpression(node)) return !URL_PROPERTY.test(node.name.text);
  if (ts.isElementAccessExpression(node)) return true;
  // `new Request(request.clone())` copies the incoming request too.
  if (ts.isCallExpression(node)) {
    const callee = unwrap(node.expression);
    return ts.isPropertyAccessExpression(callee) && callee.name.text === "clone";
  }
  // Conditionals such as `x instanceof NextRequest ? x : new NextRequest(x)`
  // are caught at the inner `new` expression.
  return false;
}

function findRequestRebuilds(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      REQUEST_CONSTRUCTORS.has(node.expression.text) &&
      node.arguments?.[0] &&
      rebuildsRequest(node.arguments[0])
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${line + 1}: ${node.getText().replace(/\s+/g, " ").slice(0, 80)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("incoming requests are passed on unchanged", () => {
  it("no source file builds a new request from an existing one", () => {
    const files = sourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(1000);
    const offenders = files.flatMap((file) =>
      findRequestRebuilds(file, fs.readFileSync(file, "utf8")).map(
        (hit) => `${path.relative(SRC_DIR, file).replaceAll("\\", "/")}:${hit}`
      )
    );
    expect(offenders).toEqual([]);
    // Parsing every source file takes close to the 10 s default under the CI
    // coverage run (it timed out there on pull request #234).
  }, 60_000);

  it.each([
    ["new NextRequest(request)", 1],
    ["new NextRequest(incoming)", 1],
    ["new Request(req, { method: 'POST' })", 1],
    ["new NextRequest(context.request)", 1],
    ["new NextRequest(\n  incoming as Request\n)", 1],
    ["const r = x instanceof NextRequest ? x : new NextRequest(x);", 1],
    ["new Request(request.clone())", 1],
    ["new NextRequest(request.url, { headers: request.headers })", 0],
    ["new NextRequest(incoming.nextUrl.href)", 0],
    ["new Request(url)", 0],
    ["new Request(EDGE_CACHE_PREFIX + encodeURIComponent(key))", 0],
    ["new NextRequest(`http://localhost${path}`)", 0],
    ["new NextRequest(new URL('/x', base))", 0],
  ])("scanner: %s", (code, count) => {
    expect(findRequestRebuilds("sample.ts", code)).toHaveLength(count);
  });
});
