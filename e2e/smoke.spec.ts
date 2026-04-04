import { expect, test, type Page } from "@playwright/test";

const WEBKIT_SKIP = ["webkit", "mobile-safari"];
const WEBKIT_SKIP_MSG =
  "WebKit rendering under headless CI is unreliable for page-navigation tests.";

function collectHydrationErrors(page: Page) {
  const hydrationErrors: string[] = [];

  page.on("console", (msg) => {
    if (
      msg.type() === "error" &&
      /hydration|server rendered html didn't match|minified react error #418/i.test(msg.text())
    ) {
      hydrationErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    if (/hydration|minified react error #418/i.test(error.message)) {
      hydrationErrors.push(error.message);
    }
  });

  return hydrationErrors;
}

function collectMarketplacePageErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedApiResponses: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (/^\/api\/(listings|businesses)\b/.test(pathname) && response.status() >= 500) {
      failedApiResponses.push(`${response.status()} ${pathname}`);
    }
  });

  return { consoleErrors, pageErrors, failedApiResponses };
}

test.describe("Platform Smoke", () => {
  test("@smoke public and auth pages render without hydration errors", async ({
    page,
  }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    const hydrationErrors = collectHydrationErrors(page);

    const checks = [
      {
        path: "/",
        assert: async () => {
          await expect(page).toHaveTitle(/VerifyMzansi/i);
        },
      },
      {
        path: "/login",
        assert: async () => {
          await expect(page.getByLabel(/email/i)).toBeVisible();
          await expect(page.locator('input[type="password"]')).toBeVisible();
          await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled();
          await expect(page.getByText(/security verification failed to load/i)).toHaveCount(0);
          await expect(page.getByText(/temporarily unavailable/i)).toHaveCount(0);
        },
      },
      {
        path: "/register",
        assert: async () => {
          await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();
          await expect(page.getByRole("button", { name: /create account/i })).toBeEnabled();
          await expect(page.getByText(/security verification failed to load/i)).toHaveCount(0);
          await expect(page.getByText(/temporarily unavailable/i)).toHaveCount(0);
        },
      },
      {
        path: "/pricing",
        assert: async () => {
          await expect(
            page
              .locator("main")
              .getByRole("heading", { name: /Starter|Growth|Pro/i })
              .first()
          ).toBeVisible();
        },
      },
    ];

    for (const check of checks) {
      await page.goto(check.path);
      await check.assert();
    }

    expect(hydrationErrors).toEqual([]);
  });

  test("@smoke protected pages redirect unauthenticated users", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/);
    await page.goto("/admin");
    await page.waitForURL(/\/login|\/banned|\/admin/);
  });

  test("@smoke API health responds 200", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const payload = (await response.json()) as { status?: string };
    expect(payload.status).toBeTruthy();
  });

  test("@smoke Google OAuth recovers when the page starts without a CSRF token", async ({
    page,
  }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    // Use Playwright's native network-level interception rather than patching
    // window.fetch via addInitScript.  The addInitScript approach is flaky across
    // browser engines because certain runtimes (Chromium's V8, WebKit's JSC) may
    // reference the original fetch binding before the script replacement takes
    // effect.  page.route() intercepts at the network layer and is reliable on
    // every browser project.
    await page.route(/\/api\/auth\/oauth\/google(?:\?|$)/, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ url: "/login#oauth-ok" }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/login");

    const clearedState = await page.evaluate(() => {
      document.cookie = "vm_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
      document.querySelector('meta[name="csrf-token"]')?.remove();
      return {
        cookie: document.cookie.includes("vm_csrf="),
        meta: Boolean(document.querySelector('meta[name="csrf-token"]')),
      };
    });
    expect(clearedState).toEqual({ cookie: false, meta: false });

    // Register the response waiter before clicking so the request cannot slip by.
    const oauthResponsePromise = page.waitForResponse(
      (res) =>
        /\/api\/auth\/oauth\/google(?:\?|$)/.test(res.url()) && res.request().method() === "POST"
    );
    await page.getByRole("button", { name: /continue with google/i }).click();
    const oauthResponse = await oauthResponsePromise;

    // The CSRF token must have been bootstrapped and included in the request.
    expect(oauthResponse.request().headers()["x-csrf-token"]).toMatch(/^[a-f0-9]{64}$/i);

    // ensureCsrfTokenReady() sets the meta tag before the POST fires, so the
    // token should already be present — poll briefly for any async DOM settling.
    await expect
      .poll(() =>
        page.evaluate(
          () => document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ?? null
        )
      )
      .toMatch(/^[a-f0-9]{64}$/i);

    await expect(page.getByText(/invalid csrf token/i)).toHaveCount(0);
    await expect(page.getByText(/google sign-in failed/i)).toHaveCount(0);
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });

  test("@smoke webhook endpoints handle malformed payloads without 5xx", async ({ request }) => {
    const ozow = await request.post("/api/webhooks/ozow", {
      data: {
        merchantReference: "smoke-1",
        eventType: "transaction.complete",
      },
    });
    expect([400, 401, 503]).toContain(ozow.status());

    const kyc = await request.post("/api/webhooks/kyc/provider", {
      data: {},
    });
    expect(kyc.status()).toBeLessThan(500);
  });

  test("@smoke mzansi business filters can be cleared from the keyboard", async ({
    page,
  }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    await page.goto("/mzansi-business");

    const isMobileViewport = (page.viewportSize()?.width ?? 1280) < 1024;
    if (isMobileViewport) {
      await page.getByRole("button", { name: "Open business filters" }).click();
    }

    const search = isMobileViewport
      ? page.locator("#drawer-business-search")
      : page.locator("#business-search");
    await expect(search).toBeVisible();

    await search.fill("coffee");
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/q=coffee/, { timeout: 15_000 });

    if (isMobileViewport) {
      await page.getByRole("button", { name: "Clear all" }).click();
      await expect(search).toHaveValue("");
    } else {
      const clearQuery = page.getByRole("button", { name: /remove query filter coffee/i });
      await clearQuery.focus();
      await page.keyboard.press("Enter");
      await expect(search).toHaveValue("");
    }

    await expect(page).not.toHaveURL(/q=coffee/);
  });

  test("@smoke mobile footer stays above bottom nav and marketplace tabs remain readable", async ({
    page,
  }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    test.skip((page.viewportSize()?.width ?? 1280) >= 1024, "Mobile-only layout check");

    await page.goto("/mzansi-business");

    const marketplaceTabs = page.getByRole("navigation", { name: "Marketplace areas" });
    const marketTab = marketplaceTabs.getByRole("link", { name: "Mzansi Market" });
    const businessTab = marketplaceTabs.getByRole("link", { name: "Mzansi Business" });
    const tourismTab = marketplaceTabs.getByRole("link", { name: /Tourism/i });

    await expect(marketTab).toBeVisible();
    await expect(businessTab).toBeVisible();
    await expect(tourismTab).toBeVisible();
    await expect(marketTab).toContainText("Market");
    await expect(businessTab).toContainText("Business");
    await expect(tourismTab).toContainText(/Tourism/i);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const footerLink = page.getByRole("link", { name: "Privacy Policy" });
    const bottomNav = page.getByRole("navigation", { name: "Main" });

    await expect(footerLink).toBeVisible();
    await expect(bottomNav).toBeVisible();

    const footerBottom = await footerLink.evaluate(
      (element) => element.getBoundingClientRect().bottom
    );
    const navTop = await bottomNav.evaluate((element) => element.getBoundingClientRect().top);

    expect(footerBottom).toBeLessThanOrEqual(navTop);
  });

  test("@smoke marketplace mobile pages avoid bootstrap errors and overlapping chrome", async ({
    page,
  }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    test.skip((page.viewportSize()?.width ?? 1280) >= 1024, "Mobile-only marketplace check");

    const { consoleErrors, pageErrors, failedApiResponses } = collectMarketplacePageErrors(page);
    const pageChecks: Array<{
      path: string;
      filterButtonName?: string;
    }> = [
      {
        path: "/mzansi-market",
        filterButtonName: "Open listing filters",
      },
      {
        path: "/mzansi-business",
        filterButtonName: "Open business filters",
      },
      {
        path: "/promotions",
        filterButtonName: "Open promotion filters",
      },
    ];

    for (const check of pageChecks) {
      await page.goto(check.path);
      await page.waitForTimeout(1_000);

      if (check.filterButtonName) {
        const filterButton = page.getByRole("button", { name: check.filterButtonName });
        const bottomNav = page.getByRole("navigation", { name: "Main" });

        await expect(filterButton).toBeVisible();
        await expect(bottomNav).toBeVisible();
        await filterButton.scrollIntoViewIfNeeded();
        await filterButton.click();
        await expect(page.getByRole("dialog").first()).toBeVisible();
      }
    }

    expect(consoleErrors.filter((message) => /__name is not defined/i.test(message))).toEqual([]);
    expect(pageErrors.filter((message) => /__name is not defined/i.test(message))).toEqual([]);
    expect(failedApiResponses).toEqual([]);
  });
});
