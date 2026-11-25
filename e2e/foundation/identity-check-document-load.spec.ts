import { expect, test } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import { browserSessionCookies, readTestCopy } from "./support/test-copy";

// The automatic ID check's frame and camera rules come only with a document
// load of /verification (src/lib/middleware/security-headers.ts). A member who
// reaches Get verified through an in-app link (here the account menu's
// "Verification") must get a document load of /verification before the check
// can start, so no paid check is created that the frame cannot open.
//
// The copy's setting is Manual, so the page's two reads are answered in the
// browser with synthetic data (phone done; the automatic route with no check).
// Nothing is started: the test stops at the Start button.

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;

test.use({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });

test("Get verified opened from an in-app link is a document load before the check can start", async ({
  context,
  page,
}) => {
  const session = await browserSessionCookies(readTestCopy(), "verifiedMember");
  await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
  await page.route("**/api/verification/status", (route) =>
    route.fulfill({
      json: {
        accountVerificationStatus: "incomplete",
        overallStatus: "incomplete",
        steps: [{ step_type: "phone", status: "approved" }],
      },
    })
  );
  const starts: string[] = [];
  await page.route("**/api/verification/identity-check", (route) => {
    if (route.request().method() !== "GET") {
      starts.push(route.request().method());
      return route.abort("blockedbyclient");
    }
    return route.fulfill({ json: { route: "automatic", reason: null, check: null } });
  });
  // Document loads of Get verified and whether they allow the check's frame.
  const documents: Array<{ path: string; framesCheck: boolean }> = [];
  page.on("response", (response) => {
    if (response.request().resourceType() !== "document") return;
    const url = new URL(response.url());
    if (url.pathname !== "/verification") return;
    const policy = response.headers()["content-security-policy"] ?? "";
    documents.push({
      path: url.pathname + url.search,
      framesCheck: /frame-src[^;]*https:\/\/verify\.didit\.me/.test(policy),
    });
  });

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Verification" }).click();

  const start = page.getByRole("button", { name: /Start ID check/ });
  await expect(start).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe("/verification");
  // The page is now a document load of /verification (the one reload after
  // the in-app link), whose headers allow the check's frame.
  const loadedAt = await page.evaluate(
    () => new URL(performance.getEntriesByType("navigation")[0]!.name).pathname
  );
  expect(loadedAt).toBe("/verification");
  expect(documents.length).toBeGreaterThanOrEqual(1);
  expect(documents.every((document) => document.framesCheck)).toBe(true);
  expect(starts).toEqual([]);
});
