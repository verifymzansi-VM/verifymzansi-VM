import { expect, test } from "@playwright/test";

/**
 * @smoke Addon checkout route availability tests.
 *
 * These tests verify that the addon checkout API routes are present in the
 * deployed build. They use a synthetic UUID and hit the POST endpoints
 * directly via the Playwright request context.
 *
 * Expected behaviour:
 *   - If the route EXISTS → we get an auth/validation error (401 / 400) or
 *     a business-logic error, but never 404.
 *   - If the route is MISSING from the build → Next.js returns 404, failing
 *     the test. This is the exact class of bug that caused the
 *     "feature-listing checkout broken" incident.
 */

const SYNTHETIC_ID = "00000000-0000-0000-0000-000000000000";

// ── Listing addon routes ──────────────────────────────────────────────

test.describe("Addon checkout routes — listings", () => {
  const routes = [
    { name: "featured", path: `/api/listings/${SYNTHETIC_ID}/featured` },
    { name: "urgent", path: `/api/listings/${SYNTHETIC_ID}/urgent` },
    { name: "boost", path: `/api/listings/${SYNTHETIC_ID}/boost` },
  ];

  for (const { name, path } of routes) {
    test(`@smoke POST ${name} listing route exists (not 404)`, async ({ request }) => {
      const res = await request.post(path);
      // The route is reachable — any status except 404/405 is acceptable
      expect(res.status(), `Expected ${name} route to exist, but got ${res.status()}`).not.toBe(
        404
      );
      expect(res.status()).not.toBe(405);
    });
  }
});
