import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const root = process.cwd();
const output = path.join(root, "docs/backend-foundation/evidence");
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
const sources = [...walk(path.join(root, "src")), ...walk(path.join(root, "workers"))].filter(
  (f) => /\.(ts|tsx|js|jsx)$/.test(f) && !/\.(test|spec)\.|\/__tests__\//.test(relative(f))
);
const literals = (n) =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
const line = (sf, n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
const records = [];
for (const file of sources) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const record = {
    file: relative(file),
    sha256Base64url: crypto.createHash("sha256").update(text).digest("base64url"),
    lines: text.split("\n").length,
    client: /^\s*['"]use client['"]/.test(text),
    imports: [],
    tables: [],
    rpcs: [],
    apiReferences: [],
    fields: [],
    auth: [],
    methods: [],
  };
  const visit = (n) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) {
      const spec = literals(n.moduleSpecifier);
      if (spec) record.imports.push(spec);
    }
    if (ts.isCallExpression(n)) {
      const name = ts.isPropertyAccessExpression(n.expression)
        ? n.expression.name.text
        : ts.isIdentifier(n.expression)
          ? n.expression.text
          : "";
      const value = literals(n.arguments[0]);
      const item = {
        name: value ?? n.arguments[0]?.getText(sf).slice(0, 160),
        line: line(sf, n),
        static: value !== null,
      };
      if (name === "from") record.tables.push(item);
      if (name === "rpc") record.rpcs.push(item);
      if (["getUser", "getClaims", "getSession"].includes(name))
        record.auth.push({ method: name, line: line(sf, n) });
      if (["register", "setValue", "watch"].includes(name) && value)
        record.fields.push({ name: value, line: line(sf, n), origin: name });
    }
    if (
      (ts.isStringLiteral(n) ||
        ts.isNoSubstitutionTemplateLiteral(n) ||
        ts.isTemplateExpression(n)) &&
      n.getText(sf).includes("/api/")
    )
      record.apiReferences.push({ expression: n.getText(sf).slice(0, 220), line: line(sf, n) });
    if (
      ts.isJsxAttribute(n) &&
      ["name", "id"].includes(n.name.getText(sf)) &&
      n.initializer &&
      ts.isStringLiteral(n.initializer)
    )
      record.fields.push({
        name: n.initializer.text,
        line: line(sf, n),
        origin: "jsx-" + n.name.getText(sf),
      });
    if (
      ts.isFunctionDeclaration(n) &&
      n.name &&
      ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"].includes(n.name.text)
    )
      record.methods.push(n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  records.push(record);
}
const byPath = new Map(records.map((r) => [r.file, r]));
const resolve = (file, spec) => {
  if (!(spec.startsWith("@/") || spec.startsWith("."))) return null;
  const base = spec.startsWith("@/")
    ? "src/" + spec.slice(2)
    : path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  return [
    base,
    ...[".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"].map((x) => base + x),
  ].find((x) => byPath.has(x));
};
const closure = (seeds) => {
  const seen = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !byPath.has(file)) continue;
    seen.add(file);
    for (const s of byPath.get(file).imports) {
      const f = resolve(file, s);
      if (f) queue.push(f);
    }
  }
  return [...seen].sort();
};
const url = (file) =>
  "/" +
  path.posix
    .dirname(file)
    .replace(/^src\/app\/?/, "")
    .split("/")
    .filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@"))
    .join("/");
const pages = records
  .filter((r) => /^src\/app\/(?:.*\/)?page\.tsx?$/.test(r.file))
  .map((r) => {
    const layouts = [];
    let dir = path.posix.dirname(r.file);
    while (dir.startsWith("src/app")) {
      for (const ext of ["tsx", "ts"]) {
        const f = dir + "/layout." + ext;
        if (byPath.has(f)) layouts.push(f);
      }
      if (dir === "src/app") break;
      dir = path.posix.dirname(dir);
    }
    const deps = closure([r.file, ...layouts]);
    const reachable = deps.map((f) => byPath.get(f));
    return {
      url: url(r.file),
      file: r.file,
      lines: r.lines,
      client: r.client,
      layouts,
      dependencies: deps,
      tableReferences: reachable.flatMap((x) => x.tables.map((t) => ({ ...t, file: x.file }))),
      rpcReferences: reachable.flatMap((x) => x.rpcs.map((t) => ({ ...t, file: x.file }))),
      apiReferences: reachable.flatMap((x) => x.apiReferences.map((t) => ({ ...t, file: x.file }))),
      directFields: r.fields,
    };
  });
const routes = records
  .filter((r) => /src\/app\/.*\/route\.tsx?$/.test(r.file))
  .map((r) => ({
    url: url(r.file),
    file: r.file,
    methods: r.methods,
    dependencies: closure([r.file]),
    tables: r.tables,
    rpcs: r.rpcs,
    auth: r.auth,
  }));
const functions = JSON.parse(fs.readFileSync(path.join(output, "functions.json"), "utf8"));
const dbNames = new Set(functions.map((f) => f.name));
const called = new Set(records.flatMap((r) => r.rpcs.filter((x) => x.static).map((x) => x.name)));
const drift = {
  missingRpcs: records.flatMap((r) =>
    r.rpcs.filter((x) => x.static && !dbNames.has(x.name)).map((x) => ({ ...x, file: r.file }))
  ),
  databaseFunctionsWithoutStaticSrcRpcCall: functions
    .filter((x) => !called.has(x.name))
    .map((x) => x.signature),
  dynamicRpcCalls: records.flatMap((r) =>
    r.rpcs.filter((x) => !x.static).map((x) => ({ ...x, file: r.file }))
  ),
};
const allFiles = walk(path.join(root, "src"));
const summary = {
  capturedAt: new Date().toISOString(),
  timezone: "Africa/Johannesburg",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceFiles: records.length,
  pages: pages.length,
  routes: routes.length,
  migrationFiles: fs
    .readdirSync(path.join(root, "supabase/migrations"))
    .filter((x) => x.endsWith(".sql")).length,
  unitTestFiles: allFiles.filter((f) => /\.(test|spec)\.[tj]sx?$/.test(f)).length,
  e2eSpecs: walk(path.join(root, "e2e")).filter((f) => /\.spec\.[tj]s$/.test(f)).length,
  authCalls: records
    .flatMap((x) => x.auth)
    .reduce((a, x) => ((a[x.method] = (a[x.method] ?? 0) + 1), a), {}),
  missingRpcs: drift.missingRpcs,
  limitations: [
    "AST literal discovery and import reachability are overapproximations, not runtime execution proof.",
    "Dynamic imports, runtime table names, JSX component conditions and generated URLs require manual review.",
    "Uncalled database functions may be used by policies, triggers, SQL functions, cron, workers or external callers; never delete based on this inventory.",
    "Layout imports include shared auth/UI dependencies and can overstate per-page tables.",
    "No private environment values or user records are collected.",
  ],
};
for (const [name, data] of Object.entries({
  "source-inventory": records,
  "page-inventory": pages,
  "route-inventory": routes,
  "rpc-drift": drift,
  "inventory-summary": summary,
}))
  fs.writeFileSync(path.join(output, name + ".json"), JSON.stringify(data, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
