import { readdirSync, readFileSync } from "node:fs";
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
// Foundation handlers, whose staff commands check the policy in the database.
const FOUNDATION_HANDLER = /from "@\/lib\/foundation\//;
const STAFF_AUTHORITY = /\b(verify[A-Za-z]*FromDb|readStaffAccessFromDb)\(/;
// The modules that define the role lookups and the MFA guards themselves.
const DEFINITIONS = new Set(["src/lib/auth/admin-access.ts"]);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full.split(path.sep).join("/")]
      : [];
  });
}

const source = (file: string) => readFileSync(file, "utf8");

describe("staff two-step coverage", () => {
  it("applies the MFA policy wherever staff authority is read from the database", () => {
    const missing = files("src")
      .filter((file) => !DEFINITIONS.has(file))
      .filter((file) => STAFF_AUTHORITY.test(source(file)) && !MFA_GUARDS.test(source(file)));
    expect(missing).toEqual([]);
  });

  // Routes on the foundation backend reach the database only through api
  // commands, and every staff command resolves its caller with
  // internal.staff_actor, which applies the same policy in the database.
  it("guards every back-office API route", () => {
    const routes = files("src/app/api/admin").filter((file) => file.endsWith("/route.ts"));
    expect(routes.length).toBeGreaterThan(20);
    const unguarded = routes.filter(
      (file) => !MFA_GUARDS.test(source(file)) && !FOUNDATION_HANDLER.test(source(file))
    );
    expect(unguarded).toEqual([]);
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

const routeKey = (file: string) => file.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "");
const routeFiles = files("src/app").filter((file) => file.endsWith("/route.ts"));
const foundRoutes: Found = Object.fromEntries(
  routeFiles.map((file) => [routeKey(file), exportedMethods(source(file))])
);
const classified = (access: RouteAccess) =>
  Object.entries(ROUTE_ACCESS)
    .filter(([, methods]) => Object.values(methods).includes(access))
    .map(([route]) => route);
const routeSource = (route: string) => source(`src/app/${route}/route.ts`);

// A shared secret compared in constant time, or a provider signature check.
const SERVICE_CHECK =
  /\btimingSafeEqual\(|\bverify[A-Za-z]*Signature\(|\bhasRuntimeDiagnosticAccess\(/;
// The handler hands the request to shared code that resolves the session: a
// foundation module, a shared route helper, or a session lookup of its own.
const SESSION_HANDOFF =
  /from "@\/lib\/foundation\/|from "[^"]*\/_lib\/[^"]*"|from "\.\/foundation"|\.auth\.getUser\(/;

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

  it("applies the staff policy in every staff route", () => {
    const staff = classified("staff");
    expect(staff.length).toBeGreaterThan(30);
    const unguarded = staff.filter(
      (route) =>
        !MFA_GUARDS.test(routeSource(route)) && !FOUNDATION_HANDLER.test(routeSource(route))
    );
    expect(unguarded).toEqual([]);
  });

  it("hands every signed-in route to code that resolves the session", () => {
    const signedIn = classified("signed-in");
    expect(signedIn.length).toBeGreaterThan(80);
    expect(signedIn.filter((route) => !SESSION_HANDOFF.test(routeSource(route)))).toEqual([]);
  });

  it("lists every back-office page as a staff page", () => {
    const pages = files("src/app/admin")
      .filter((file) => file.endsWith("/page.tsx"))
      .map((file) => file.replace(/^src\/app\//, "").replace(/\/page\.tsx$/, ""))
      .sort();
    expect(pages).toEqual([...STAFF_PAGES].sort());
  });
});
