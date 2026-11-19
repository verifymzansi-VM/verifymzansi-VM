import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_ROUTE_REASONS,
  ROUTE_ACCESS,
  STAFF_PAGES,
  type RouteAccess,
  type RouteMethod,
} from "@/test/route-access-inventory";

/**
 * Every place that grants staff power must also apply the staff two-step
 * policy (authenticator app, re-verified every 12 hours, 15 minutes for
 * sensitive actions). These helpers all run checkStaffApiMfa/evaluateStaffMfa.
 */
const MFA_GUARDS = /\b(requireStaff|checkStaffApiMfa|enforceAdminMutationGuard|evaluateStaffMfa)\(/;
const STAFF_AUTHORITY = /\b(verify[A-Za-z]*FromDb|readStaffAccessFromDb)\(/;
// The modules that define the role lookups and the MFA guards themselves.
const DEFINITIONS = new Set(["src/lib/auth/admin-access.ts"]);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)
      ? [full.split(path.sep).join("/")]
      : [];
  });
}

const source = (file: string) => readFileSync(file, "utf8");
const ROUTE_FILE = /\/route\.(ts|tsx|js|mjs)$/;

/**
 * The calls that resolve the caller's verified session: a foundation route
 * context's authenticate()/authenticateCaller(), the staff guards (which read
 * the session first), and a legacy auth.getUser(). Static text only.
 */
const SESSION_PRIMITIVE = new RegExp(
  String.raw`\.authenticate(?:Caller)?\(|\.auth\.getUser\(|` + MFA_GUARDS.source
);
/**
 * Shared route helpers that count as a session entry point. Each one's own
 * body must call a SESSION_PRIMITIVE (checked below), so a route may reach the
 * session through one of them.
 */
const SESSION_HELPERS: Record<string, string> = {
  handleFoundationOwnerRoute: "src/lib/foundation/owner-route.ts",
  handleFoundationBillingRoute: "src/lib/foundation/billing-route.ts",
  protectBusinessEvidenceRoute: "src/lib/foundation/business-evidence-route.ts",
};
// A call, allowing explicit type arguments: name(...) or name<T>(...).
const CALL = String.raw`(?:<[^>()]*>)?\(`;
const SESSION_ENTRY = new RegExp(
  `${SESSION_PRIMITIVE.source}|\\b(?:${Object.keys(SESSION_HELPERS).join("|")})${CALL}`
);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Source text without // and /* *\/ comments, so a comment that names a
 * guard cannot satisfy a check. String and template literals are kept as they
 * are (a "//" inside a URL is not a comment). Regular-expression literals are
 * not parsed; this is a text check, not a JavaScript parser.
 */
function withoutComments(code: string): string {
  return code.replace(
    /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, literal: string | undefined) => literal ?? match.replace(/[^\n]/g, "")
  );
}

/** A route or module's source text with comments removed. */
const codeOf = (file: string) => withoutComments(source(file));

// The start of the next top-level declaration ends the one before it.
const TOP_LEVEL_DECLARATION =
  /^(?:export|function|async|const|let|var|import|type|interface|class|enum|declare)\b/gm;

/**
 * The text of a top-level function or const named `name`: from its start to
 * the next top-level declaration (or the end of the file). Ending at the next
 * declaration, not at the first "}" line, keeps a braceless arrow const or a
 * wrapped const ending in "});" from running into the function after it.
 */
function definitionOf(code: string, name: string): string | null {
  const start = new RegExp(
    String.raw`^(?:export\s+)?(?:(?:async\s+)?function\s*\*?\s*|(?:const|let)\s+)${escapeRegExp(name)}\b`,
    "m"
  ).exec(code);
  if (!start) return null;
  const firstLineEnd = code.indexOf("\n", start.index);
  if (firstLineEnd === -1) return code.slice(start.index);
  TOP_LEVEL_DECLARATION.lastIndex = firstLineEnd + 1;
  const next = TOP_LEVEL_DECLARATION.exec(code);
  return code.slice(start.index, next ? next.index : undefined);
}

/** Whether `body` calls a session entry point, directly or through helpers defined in `code`. */
function callsSessionEntry(body: string, code: string, seen = new Set<string>()): boolean {
  if (SESSION_ENTRY.test(body)) return true;
  for (const [, name] of body.matchAll(new RegExp(String.raw`\b([A-Za-z_$][\w$]*)${CALL}`, "g"))) {
    if (seen.has(name)) continue;
    seen.add(name);
    const local = definitionOf(code, name);
    if (local && local !== body && callsSessionEntry(local, code, seen)) return true;
  }
  return false;
}

/** The source file an import specifier names, or null for a package. */
function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) base = path.posix.join(path.posix.dirname(from), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`])
    if (/\.(ts|tsx|js|mjs)$/.test(candidate) && existsSync(candidate)) return candidate;
  return null;
}

/**
 * Whether a route file calls a session entry point itself, or calls an
 * imported function whose own definition does (one import hop; helpers in that
 * same module are followed). A module that merely is imported does not count.
 */
function reachesSession(file: string): boolean {
  const code = codeOf(file);
  if (callsSessionEntry(code, code)) return true;
  for (const [, names, specifier] of code.matchAll(
    /^import\s+(?!type\b)\{([^}]*)\}\s+from\s+"([^"]+)"/gm
  )) {
    const target = resolveImport(file, specifier);
    if (!target) continue;
    const targetCode = codeOf(target);
    for (const part of names.split(",")) {
      const [remote, local = remote] = part
        .replace(/^\s*type\s+/, "")
        .split(/\s+as\s+/)
        .map((name) => name.trim());
      if (!remote || !new RegExp(String.raw`\b${escapeRegExp(local)}${CALL}`).test(code)) continue;
      const body = definitionOf(targetCode, remote);
      if (body && callsSessionEntry(body, targetCode)) return true;
    }
  }
  return false;
}

describe("staff two-step coverage", () => {
  it("applies the MFA policy wherever staff authority is read from the database", () => {
    const missing = files("src")
      .filter((file) => !DEFINITIONS.has(file))
      .filter((file) => STAFF_AUTHORITY.test(source(file)) && !MFA_GUARDS.test(source(file)));
    expect(missing).toEqual([]);
  });

  // A route either runs a staff guard itself or resolves a verified foundation
  // session (directly or through the one function it hands off to). On the
  // foundation backend every staff command then resolves its caller with
  // internal.staff_actor, which applies the same policy in the database; this
  // static check does not prove which command a route calls.
  it("guards every back-office API route", () => {
    const routes = files("src/app/api/admin").filter((file) => ROUTE_FILE.test(file));
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.filter((file) => !reachesSession(file))).toEqual([]);
  });

  it("counts a shared route helper only when it resolves the session itself", () => {
    for (const [helper, file] of Object.entries(SESSION_HELPERS)) {
      const code = codeOf(file);
      const body = definitionOf(code, helper);
      expect(body, `${helper} in ${file}`).not.toBeNull();
      expect(SESSION_PRIMITIVE.test(body ?? ""), helper).toBe(true);
    }
  });

  it("does not count an import alone as reaching the session", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "route-reach-"));
    try {
      const helper = path.join(dir, "helper.ts").split(path.sep).join("/");
      writeFileSync(
        helper,
        [
          "export function guarded(request) {",
          "  return handleFoundationOwnerRoute({ request });",
          "}",
          "export function open(request) {",
          "  return Response.json({ ok: true });",
          "}",
          "export function typed<T>({",
          "  request,",
          "}: {",
          "  request: T;",
          "}) {",
          "  return guarded(request);",
          "}",
          "",
        ].join("\n")
      );
      const route = path.join(dir, "route.ts").split(path.sep).join("/");
      const write = (body: string) => writeFileSync(route, body);
      write('import { guarded, open } from "./helper";\nexport const GET = (r) => open(r);\n');
      expect(reachesSession(route)).toBe(false);
      write('import { guarded } from "./helper";\nexport const GET = (r) => guarded(r);\n');
      expect(reachesSession(route)).toBe(true);
      // Type arguments, a multi-line parameter list and a helper in that module.
      write(
        'import { typed } from "./helper";\nexport const GET = (r) => typed<Request>({ request: r });\n'
      );
      expect(reachesSession(route)).toBe(true);
      write("export async function GET(request) {\n  return requireStaff();\n}\n");
      expect(reachesSession(route)).toBe(true);

      // An unguarded definition does not run into a guarded one after it.
      const shapes = path.join(dir, "shapes.ts").split(path.sep).join("/");
      writeFileSync(
        shapes,
        [
          "export const braceless = (r) => Response.json({ ok: true });",
          "export function guardedAfterBraceless(request) {",
          "  return handleFoundationOwnerRoute({ request });",
          "}",
          "export const wrapped = withLogging(async (r) => {",
          "  return Response.json({ ok: true });",
          "});",
          "export function guardedAfterWrapped(request) {",
          "  return requireStaff();",
          "}",
          "",
        ].join("\n")
      );
      write('import { braceless } from "./shapes";\nexport const GET = (r) => braceless(r);\n');
      expect(reachesSession(route)).toBe(false);
      write('import { wrapped } from "./shapes";\nexport const GET = (r) => wrapped(r);\n');
      expect(reachesSession(route)).toBe(false);
      write(
        'import { guardedAfterWrapped } from "./shapes";\nexport const GET = (r) => guardedAfterWrapped(r);\n'
      );
      expect(reachesSession(route)).toBe(true);

      // A comment that names a guard is not a call.
      write(
        [
          "// This route does not call requireStaff() or handleFoundationOwnerRoute().",
          "/* Nor context.authenticateCaller(); it is open. */",
          "export async function GET() {",
          '  return Response.json({ docs: "https://example.test/x" }); // supabase.auth.getUser()',
          "}",
          "",
        ].join("\n")
      );
      expect(reachesSession(route)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies the two-step policy to every foundation staff command", () => {
    const staffActor = source("database/foundation/current/functions/internal/staff_actor.sql");
    expect(staffActor).toMatch(/claims->>'aal' is distinct from 'aal2'/);
    expect(staffActor).toMatch(/factor_type = 'totp' and f\.status = 'verified'/);
    expect(staffActor).toMatch(/interval '12 hours'/);
    expect(staffActor).toMatch(/needs_mfa and totp_at < .*interval '15 minutes'/);
  });

  it("guards every back-office page itself, not only through the layout", () => {
    const pages = files("src/app/admin").filter((file) => file.endsWith("/page.tsx"));
    expect(pages.length).toBeGreaterThan(20);
    const unguarded = pages.filter(
      (file) => !MFA_GUARDS.test(source(file)) && !/\bAreaAdminPage\b/.test(source(file))
    );
    expect(unguarded).toEqual([]);
    expect(source("src/app/admin/layout.tsx")).toMatch(/requireStaff\(\)/);
  });

  it("lets only the two-step page itself open before verification", () => {
    const pending = files("src/app").filter((file) => /allowPendingMfa:\s*true/.test(source(file)));
    expect(pending).toEqual(["src/app/staff/two-step/page.tsx"]);
  });
});

/**
 * The route inventory (src/test/route-access-inventory.ts): every route
 * handler, method by method, is public (a reviewed list with reasons),
 * signed-in, staff, or a service route that checks a signature or shared
 * secret. A new route or method fails here until it is classified.
 */
const METHODS: readonly RouteMethod[] = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];

/** The HTTP methods a route module exports, however it exports them. */
function exportedMethods(code: string): RouteMethod[] {
  const names = new Set<string>();
  for (const match of code.matchAll(
    /export\s+(?:async\s+)?(?:function\s*\*?|const|let|var)\s+([A-Z]+)\b/g
  ))
    names.add(match[1]);
  for (const match of code.matchAll(/export\s*\{([^}]*)\}/g))
    for (const part of match[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.add(name);
    }
  // export const { GET, POST: post, PATCH = fallback } = handlers;
  for (const match of code.matchAll(/export\s+(?:const|let|var)\s*\{([^}]*)\}\s*=/g))
    for (const part of match[1].split(",")) {
      const name = part.split("=")[0].split(":").pop()?.trim();
      if (name) names.add(name);
    }
  return METHODS.filter((method) => names.has(method));
}

type Found = Record<string, RouteMethod[]>;
type Inventory = Record<string, Partial<Record<RouteMethod, RouteAccess>>>;

/** Routes or methods missing from the inventory, and entries that no longer exist. */
function inventoryProblems(found: Found, inventory: Inventory): string[] {
  const problems: string[] = [];
  for (const [route, methods] of Object.entries(found)) {
    const entry = inventory[route];
    if (!entry) {
      problems.push(`${route}: not classified (add it to src/test/route-access-inventory.ts)`);
      continue;
    }
    for (const method of methods)
      if (!entry[method]) problems.push(`${route} ${method}: not classified`);
    for (const method of Object.keys(entry) as RouteMethod[])
      if (!methods.includes(method)) problems.push(`${route} ${method}: listed but not exported`);
  }
  for (const route of Object.keys(inventory))
    if (!found[route]) problems.push(`${route}: listed but the route no longer exists`);
  return problems;
}

const routeKey = (file: string) => file.replace(/^src\/app\//, "").replace(ROUTE_FILE, "");
const routeFiles = files("src/app").filter((file) => ROUTE_FILE.test(file));
const routeFileByKey = new Map(routeFiles.map((file) => [routeKey(file), file]));
const foundRoutes: Found = Object.fromEntries(
  routeFiles.map((file) => [routeKey(file), exportedMethods(source(file))])
);
const classified = (access: RouteAccess) =>
  Object.entries(ROUTE_ACCESS)
    .filter(([, methods]) => Object.values(methods).includes(access))
    .map(([route]) => route);
const routeFile = (route: string) => routeFileByKey.get(route) ?? `src/app/${route}/route.ts`;
const routeSource = (route: string) => source(routeFile(route));

// A shared secret compared in constant time, or a provider signature check.
const SERVICE_CHECK =
  /\btimingSafeEqual\(|\bverify[A-Za-z]*Signature\(|\bhasRuntimeDiagnosticAccess\(/;

describe("route access inventory", () => {
  it("finds the exported methods of a route module", () => {
    expect(
      exportedMethods(
        [
          "export async function GET() {}",
          "export function POST() {}",
          "export const PATCH = handler;",
          "export { remove as DELETE, helper };",
          "export { HEAD } from './probe';",
          "export function GETTER() {}",
        ].join("\n")
      )
    ).toEqual(["GET", "HEAD", "POST", "PATCH", "DELETE"]);
    expect(exportedMethods("export const { GET, post: PUT, OPTIONS = x } = handlers;")).toEqual([
      "GET",
      "PUT",
      "OPTIONS",
    ]);
  });

  it("finds route handlers of every file type", () => {
    expect(routeFileByKey.get("api/share-preview/[type]/[id]")).toBe(
      "src/app/api/share-preview/[type]/[id]/route.tsx"
    );
  });

  it("classifies every route handler and every method it exports", () => {
    expect(routeFiles.length).toBeGreaterThan(150);
    expect(inventoryProblems(foundRoutes, ROUTE_ACCESS)).toEqual([]);
  });

  it("fails for a new route or a new method that is not classified", () => {
    const withNewRoute = { ...foundRoutes, "api/new-thing": ["POST"] as RouteMethod[] };
    expect(inventoryProblems(withNewRoute, ROUTE_ACCESS)).toEqual([
      "api/new-thing: not classified (add it to src/test/route-access-inventory.ts)",
    ]);
    const withNewMethod = { ...foundRoutes, "api/csrf": ["GET", "POST"] as RouteMethod[] };
    expect(inventoryProblems(withNewMethod, ROUTE_ACCESS)).toEqual([
      "api/csrf POST: not classified",
    ]);
  });

  it("gives a reviewed reason for every public method, and only for those", () => {
    const publicMethods = Object.entries(ROUTE_ACCESS).flatMap(([route, methods]) =>
      Object.entries(methods)
        .filter(([, access]) => access === "public")
        .map(([method]) => `${route} ${method}`)
    );
    expect(Object.keys(PUBLIC_ROUTE_REASONS).sort()).toEqual(publicMethods.sort());
    for (const [key, reason] of Object.entries(PUBLIC_ROUTE_REASONS))
      expect(reason.trim().length, key).toBeGreaterThan(10);
  });

  it("keeps back-office, internal and webhook routes in their classes", () => {
    const misplaced = Object.entries(ROUTE_ACCESS).flatMap(([route, methods]) =>
      Object.entries(methods)
        .filter(([, access]) => {
          if (route.startsWith("api/admin/") || route.startsWith("api/foundation/staff/"))
            return access !== "staff";
          if (route.startsWith("api/webhooks/") || route.startsWith("api/internal/"))
            return access !== "service";
          return false;
        })
        .map(([method, access]) => `${route} ${method}: ${access}`)
    );
    expect(misplaced).toEqual([]);
  });

  it("checks a signature or shared secret in every service route itself", () => {
    const service = classified("service");
    expect(service.length).toBeGreaterThan(5);
    expect(service.filter((route) => !SERVICE_CHECK.test(routeSource(route)))).toEqual([]);
  });

  // See the limits in the header of src/test/route-access-inventory.ts.
  it("calls a staff guard or a session entry point in every staff route", () => {
    const staff = classified("staff");
    expect(staff.length).toBeGreaterThan(30);
    expect(staff.filter((route) => !reachesSession(routeFile(route)))).toEqual([]);
  });

  it("calls a session entry point in every signed-in route", () => {
    const signedIn = classified("signed-in");
    expect(signedIn.length).toBeGreaterThan(80);
    expect(signedIn.filter((route) => !reachesSession(routeFile(route)))).toEqual([]);
  });

  it("lists every back-office page as a staff page", () => {
    const pages = files("src/app/admin")
      .filter((file) => file.endsWith("/page.tsx"))
      .map((file) => file.replace(/^src\/app\//, "").replace(/\/page\.tsx$/, ""))
      .sort();
    expect(pages).toEqual([...STAFF_PAGES].sort());
  });
});
