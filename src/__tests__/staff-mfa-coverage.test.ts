import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
