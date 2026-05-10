/**
 * Build route verification test.
 *
 * Regression for incident: featured/urgent routes existed on disk but were
 * absent from the production build output, causing 404s in production.
 *
 * This test verifies that all addon API route files:
 * 1. Exist on the filesystem at the expected Next.js App Router paths.
 * 2. Export a named POST function (the HTTP method handler).
 * 3. The POST handler is async (returns a Promise).
 *
 * If any route file is missing or doesn't export POST, this test fails
 * and blocks the build in CI.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(ROOT, "app", "api");

/**
 * All addon API routes that must exist in the build.
 * Format: [human label, relative path from src/app/api/]
 */
const REQUIRED_ADDON_ROUTES = [
  ["listings/[id]/boost", "listings/[id]/boost/route.ts"],
  ["listings/[id]/featured", "listings/[id]/featured/route.ts"],
  ["listings/[id]/urgent", "listings/[id]/urgent/route.ts"],
  ["businesses/[id]/boost", "businesses/[id]/boost/route.ts"],
  ["billing/create-checkout", "billing/create-checkout/route.ts"],
] as const;

const REQUIRED_ADDON_ROUTE_IMPORTS = [
  ["listings/[id]/boost", () => import("@/app/api/listings/[id]/boost/route")],
  ["listings/[id]/featured", () => import("@/app/api/listings/[id]/featured/route")],
  ["listings/[id]/urgent", () => import("@/app/api/listings/[id]/urgent/route")],
  ["businesses/[id]/boost", () => import("@/app/api/businesses/[id]/boost/route")],
  ["billing/create-checkout", () => import("@/app/api/billing/create-checkout/route")],
] as const;

describe("Addon API route files exist and export POST", () => {
  it.each(REQUIRED_ADDON_ROUTES)("/api/%s route file exists on disk", (_label, relativePath) => {
    const fullPath = path.join(APP_DIR, relativePath);
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  it.each(REQUIRED_ADDON_ROUTE_IMPORTS)(
    "%s exports async POST",
    async (_label, importRoute) => {
      const mod = await importRoute();
      expect(typeof mod.POST).toBe("function");
      expect(mod.POST.constructor.name).toBe("AsyncFunction");
    },
    30_000
  );
});
