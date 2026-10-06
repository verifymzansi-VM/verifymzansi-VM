import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV, HOME_TITLES, navFor, navItemForPath } from "./nav";

const APP_DIR = path.join(process.cwd(), "src", "app");

function pageSource(href: string): string {
  const file = path.join(APP_DIR, ...href.split("/").filter(Boolean), "page.tsx");
  return fs.readFileSync(file, "utf8");
}

/** The capability the page's guard asks for: null for any staff member. */
function guardCapability(href: string): string | null | undefined {
  let source = pageSource(href);
  if (source.includes("AreaAdminPage(")) {
    source = fs.readFileSync(path.join(APP_DIR, "admin", "_lib", "area-admin-page.tsx"), "utf8");
  }
  const match = source.match(/requireStaff\(\s*(?:"([^"]+)")?/);
  if (!match) return undefined;
  return match[1] ?? null;
}

/** Every admin page file, as a route path. */
function adminPages(dir = path.join(APP_DIR, "admin"), route = "/admin"): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "page.tsx") found.push(route);
    if (entry.isDirectory() && !entry.name.startsWith("_")) {
      found.push(...adminPages(path.join(dir, entry.name), `${route}/${entry.name}`));
    }
  }
  return found;
}

/**
 * Pages reached from another page rather than the menu. Each is covered by
 * its parent entry's capability, checked below.
 */
const SUB_PAGES: Record<string, string> = {
  "/admin/business-verification/[id]": "/admin/business-verification",
  "/admin/dsar/new": "/admin/dsar",
  "/admin/governance/appeals/[id]": "/admin/governance/appeals",
  "/admin/governance/escalations/[id]": "/admin/governance/escalations",
  "/admin/organisations/[id]": "/admin/organisations",
};

describe("admin navigation registry", () => {
  it.each(ADMIN_NAV.map((item) => [item.href, item.capability] as const))(
    "%s asks for the same capability as the menu (%s)",
    (href, capability) => {
      expect(guardCapability(href)).toBe(capability);
    }
  );

  it("lists every admin page, or names the menu entry that leads to it", () => {
    const registered = new Set(ADMIN_NAV.map((item) => item.href));
    const unlisted = adminPages().filter(
      (route) => !registered.has(route) && !(route in SUB_PAGES)
    );
    expect(unlisted).toEqual([]);
  });

  it.each(Object.entries(SUB_PAGES).filter(([route]) => route !== "/admin/tourism-events"))(
    "%s is guarded like %s",
    (route, parent) => {
      const parentItem = ADMIN_NAV.find((item) => item.href === parent);
      expect(parentItem).toBeDefined();
      expect(guardCapability(route)).toBe(parentItem!.capability);
    }
  );

  it("gives moderators queues and areas only", () => {
    const hrefs = navFor("moderator").flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toContain("/admin/reports");
    expect(hrefs).toContain("/admin/support");
    expect(hrefs).not.toContain("/admin/governance/escalations");
    expect(hrefs).not.toContain("/admin/dsar");
    expect(hrefs).not.toContain("/admin/operations");
    expect(hrefs).not.toContain("/admin/intelligence/users");
  });

  it("gives governors decisions, compliance, oversight and commercial, but not analytics or flags", () => {
    const hrefs = navFor("governance_controller").flatMap((s) => s.items.map((i) => i.href));
    for (const href of [
      "/admin/governance/escalations",
      "/admin/dsar",
      "/admin/governance/roles",
      "/admin/trials",
      "/admin/commercial",
      "/admin/support",
    ]) {
      expect(hrefs).toContain(href);
    }
    expect(hrefs).not.toContain("/admin/feature-flags");
    expect(hrefs).not.toContain("/admin/payments");
    expect(hrefs).not.toContain("/admin/intelligence/revenue");
  });

  it("gives admins every page", () => {
    const hrefs = navFor("admin", { kyc_evidence_desk: true }).flatMap((s) =>
      s.items.map((i) => i.href)
    );
    expect(hrefs.sort()).toEqual(ADMIN_NAV.map((i) => i.href).sort());
  });

  it("hides the evidence desk while its flag is off", () => {
    const hrefs = navFor("admin").flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).not.toContain("/admin/verification/evidence");
  });

  it("names each role's home after its job", () => {
    expect(navFor("moderator")[0].items[0].label).toBe(HOME_TITLES.moderator);
    expect(navFor("governance_controller")[0].items[0].label).toBe("Decisions");
  });

  it("finds the most specific entry for a path", () => {
    expect(navItemForPath("/admin/verification/evidence")?.label).toBe("Evidence desk");
    expect(navItemForPath("/admin/governance/appeals/abc")?.href).toBe("/admin/governance/appeals");
    expect(navItemForPath("/admin")?.href).toBe("/admin");
    expect(navItemForPath("/admin/reportsx")).toBeUndefined();
  });
});
