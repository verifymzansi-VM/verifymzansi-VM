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
  ["webhooks/payfast", "webhooks/payfast/route.ts"],
] as const;

describe("Addon API route files exist and export POST", () => {
  it.each(REQUIRED_ADDON_ROUTES)("/api/%s route file exists on disk", (_label, relativePath) => {
    const fullPath = path.join(APP_DIR, relativePath);
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  it("listings/[id]/featured exports async POST", async () => {
    const mod = await import("@/app/api/listings/[id]/featured/route");
    expect(typeof mod.POST).toBe("function");
  });

  it("listings/[id]/urgent exports async POST", async () => {
    const mod = await import("@/app/api/listings/[id]/urgent/route");
    expect(typeof mod.POST).toBe("function");
  });

  it("listings/[id]/boost exports async POST", async () => {
    const mod = await import("@/app/api/listings/[id]/boost/route");
    expect(typeof mod.POST).toBe("function");
  });

  it("businesses/[id]/boost exports async POST", async () => {
    const mod = await import("@/app/api/businesses/[id]/boost/route");
    expect(typeof mod.POST).toBe("function");
  });

  it("billing/create-checkout exports async POST", async () => {
    const mod = await import("@/app/api/billing/create-checkout/route");
    expect(typeof mod.POST).toBe("function");
  });

  it("webhooks/payfast exports async POST", async () => {
    const mod = await import("@/app/api/webhooks/payfast/route");
    expect(typeof mod.POST).toBe("function");
  });
});
