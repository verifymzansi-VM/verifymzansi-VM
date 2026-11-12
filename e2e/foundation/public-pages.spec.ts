import { expect, test, type Locator, type Page } from "@playwright/test";

// Public pages of the restored website in foundation mode: the checks of the
// stub suite's smoke.spec.ts and golden.spec.ts that need no account or data,
// merged (golden's weaker duplicates dropped; its redirect, 404 and auth-guard
// checks kept). They read nothing that a visitor could not, so they share the
// test copy with every other spec. See PORTING.md.

type CapturedOauthRequest = {
  method: string;
  headers: Record<string, string>;
  body: string | null;
};

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/register",
  "/pricing",
  "/contact",
  "/privacy",
  "/terms",
  "/mzansi-market",
  "/mzansi-business",
  "/tourism-events",
  "/search",
];

function collectHydrationErrors(page: Page) {
  const hydrationErrors: string[] = [];
  page.on("console", (msg) => {
    if (
      msg.type() === "error" &&
      /hydration|server rendered html didn't match|minified react error #418/i.test(msg.text())
    )
      hydrationErrors.push(msg.text());
  });
  page.on("pageerror", (error) => {
    if (/hydration|minified react error #418/i.test(error.message))
      hydrationErrors.push(error.message);
  });
  return hydrationErrors;
}

function collectMarketplacePageErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedApiResponses: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (/^\/api\/(listings|businesses)\b/.test(pathname) && response.status() >= 500)
      failedApiResponses.push(`${response.status()} ${pathname}`);
  });
  return { consoleErrors, pageErrors, failedApiResponses };
}

/** Opens a dialog from its button, clicking again only while it is still
 * closed: a click that lands before the page hydrated does nothing. */
async function openDialog(page: Page, button: Locator) {
  const dialog = page.getByRole("dialog").first();
  await expect(async () => {
    if (!(await dialog.isVisible())) await button.click({ timeout: 2_000 });
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

function getCapturedOauthRequests(page: Page) {
  return page.evaluate(
    () =>
      (window as typeof window & { __vmzGoogleOauthRequests?: CapturedOauthRequest[] })
        .__vmzGoogleOauthRequests ?? []
  );
}

test.describe("public pages", () => {
  test("every public page answers without an error", async ({ request }) => {
    for (const path of PUBLIC_PATHS) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
    }
  });

  test("public and auth pages render without hydration errors", async ({ page }) => {
    const hydrationErrors = collectHydrationErrors(page);
    const checks = [
      {
        path: "/",
        assert: async () => {
          await expect(page).toHaveTitle(/VerifyMzansi/i);
          await expect(page.getByRole("heading").first()).toBeVisible();
          await expect(page.getByRole("link", { name: /Mzansi Business/i }).first()).toBeVisible();
        },
      },
      {
        path: "/login",
        assert: async () => {
          await expect(
            page.getByRole("heading").filter({ hasText: /Login|Sign In/i })
          ).toBeVisible();
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
            page.locator("main").getByTestId("retail-offer-half_year").first()
          ).toBeVisible();
        },
      },
    ];
    for (const check of checks) {
      await page.goto(check.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await check.assert();
    }
    expect(hydrationErrors).toEqual([]);
  });

  test("member and staff pages send visitors to sign in and back", async ({ page }) => {
    for (const path of ["/dashboard", "/verification", "/billing", "/dsar"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/login/);
      const url = new URL(page.url());
      expect(url.pathname, path).toBe("/login");
      expect(url.searchParams.get("returnUrl"), path).toBe(path);
    }
    for (const path of ["/admin", "/admin/verification/evidence"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/login/);
      expect(new URL(page.url()).pathname, path).toBe("/login");
    }
  });

  test("old area addresses redirect to Mzansi Business", async ({ page }) => {
    await page.goto("/business-ads", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/mzansi-business$/);
    await page.goto("/mall-shops", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/mzansi-business\?type=mall_store$/);
  });

  test("an unknown address answers 404", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist-12345");
    expect(response?.status()).toBe(404);
  });

  test("the health check answers 200 with a status", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    const payload = (await response.json()) as { status?: string };
    expect(payload.status).toBeTruthy();
  });

  test("webhook endpoints answer malformed payloads without a server error", async ({
    request,
  }) => {
    const ozow = await request.post("/api/webhooks/ozow", {
      data: { merchantReference: "smoke-1", eventType: "transaction.complete" },
    });
    expect([400, 401, 503]).toContain(ozow.status());
    const kyc = await request.post("/api/webhooks/kyc/provider", { data: {} });
    expect(kyc.status()).toBeLessThan(500);
  });

  test("Google sign-in recovers when the page starts without a CSRF token", async ({ page }) => {
    // The Google start request is answered in the browser: this checks the
    // page's CSRF recovery, not Google or the server route.
    await page.addInitScript(() => {
      const state = window as typeof window & {
        __vmzGoogleOauthRequests?: Array<{
          method: string;
          headers: Record<string, string>;
          body: string | null;
        }>;
      };
      const originalFetch = window.fetch.bind(window);
      const normalizeHeaders = (headersInit?: HeadersInit): Record<string, string> =>
        Object.fromEntries(
          Array.from(new Headers(headersInit).entries(), ([key, value]) => [
            key.toLowerCase(),
            value,
          ])
        );
      state.__vmzGoogleOauthRequests = [];
      window.fetch = async (input, init) => {
        const request = input instanceof Request ? input : null;
        const requestUrl =
          typeof input === "string" ? input : request ? request.url : String(input);
        const url = new URL(requestUrl, window.location.href);
        const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
        if (url.pathname === "/api/auth/oauth/google" && method === "POST") {
          state.__vmzGoogleOauthRequests?.push({
            method,
            headers: normalizeHeaders(init?.headers ?? request?.headers),
            body: typeof init?.body === "string" ? init.body : null,
          });
          return new Response(JSON.stringify({ url: "/login#oauth-ok" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return originalFetch(input, init);
      };
    });

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const clearedState = await page.evaluate(() => {
      document.cookie = "vm_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
      document.querySelector('meta[name="csrf-token"]')?.remove();
      return {
        cookie: document.cookie.includes("vm_csrf="),
        meta: Boolean(document.querySelector('meta[name="csrf-token"]')),
      };
    });
    expect(clearedState).toEqual({ cookie: false, meta: false });

    const googleButton = page.getByRole("button", { name: /continue with google/i });
    await expect(googleButton).toBeEnabled();
    await googleButton.click();
    await expect
      .poll(async () => (await getCapturedOauthRequests(page)).length, { timeout: 15_000 })
      .toBe(1);
    const oauthRequests = await getCapturedOauthRequests(page);
    expect(oauthRequests[0]?.headers["x-csrf-token"]).toMatch(/^[a-f0-9]{64}$/i);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ?? null
        )
      )
      .toMatch(/^[a-f0-9]{64}$/i);
    await expect(page).toHaveURL(/\/login#oauth-ok$/);
    await expect(page.getByText(/invalid csrf token/i)).toHaveCount(0);
    await expect(page.getByText(/google sign-in failed/i)).toHaveCount(0);
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });

  test("Mzansi Business filters can be cleared from the keyboard", async ({ page }) => {
    await page.goto("/mzansi-business", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const isMobileViewport = (page.viewportSize()?.width ?? 1280) < 1024;
    if (isMobileViewport)
      await openDialog(page, page.getByRole("button", { name: "Open business filters" }));
    const search = isMobileViewport
      ? page.locator("#drawer-business-search")
      : page.locator("#business-search");
    await expect(search).toBeVisible();

    await search.fill("coffee");
    await expect(page).toHaveURL(/q=coffee/, { timeout: 15_000 });

    if (isMobileViewport) {
      await page.getByRole("button", { name: "Clear all" }).click();
      await expect(search).toHaveValue("");
    } else {
      const clearQuery = page.getByRole("button", { name: /remove query filter coffee/i });
      await clearQuery.focus();
      await page.keyboard.press("Enter");
      await expect(search).toHaveValue("");
      await search.blur();
    }
    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"), { timeout: 15_000 })
      .toBeFalsy();
  });

  test("the phone footer and area tabs stay clear of the bottom tab bar", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) >= 768, "Mobile-only layout check");
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
    // The Tourism & Events area keeps its combined label on every screen size.
    await expect(tourismTab).toContainText("Tourism & Events");

    // Browse pages are discovery surfaces, so the tab bar shows here too.
    const bottomNav = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(bottomNav).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Video", exact: true })).toHaveAttribute(
      "href",
      "/video-mode"
    );

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const footerLink = page.locator("footer").getByRole("link", { name: "Privacy Policy" });
    await footerLink.scrollIntoViewIfNeeded();
    await expect(footerLink).toBeVisible();
    const [footerBox, navBox] = await Promise.all([
      footerLink.boundingBox(),
      bottomNav.boundingBox(),
    ]);
    expect(footerBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(navBox!.y);

    await page.goto("/");
    await expect(bottomNav).toBeVisible();
    await expect(bottomNav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  test("phone marketplace pages load cleanly and their filters clear the tab bar", async ({
    page,
  }) => {
    test.skip((page.viewportSize()?.width ?? 1280) >= 768, "Mobile-only marketplace check");
    const { consoleErrors, pageErrors, failedApiResponses } = collectMarketplacePageErrors(page);
    const pageChecks = [
      { path: "/mzansi-market", filterButtonName: "Open listing filters" },
      { path: "/mzansi-business", filterButtonName: "Open business filters" },
      { path: "/tourism-events", filterButtonName: "Open tourism and events filters" },
    ];
    const bottomNav = page.getByRole("navigation", { name: "Main", exact: true });
    for (const check of pageChecks) {
      await page.goto(check.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      const filterButton = page
        .locator(`button[aria-label^="${check.filterButtonName}"]:visible`)
        .last();
      await expect(filterButton).toBeVisible();
      await expect(filterButton).toHaveAttribute("aria-haspopup", "dialog");

      // The filters drop sits on the right wall above the tab bar rather than covering it.
      await expect(bottomNav).toBeVisible();
      const [filterBox, navBox] = await Promise.all([
        filterButton.boundingBox(),
        bottomNav.boundingBox(),
      ]);
      expect(filterBox).not.toBeNull();
      expect(navBox).not.toBeNull();
      expect(filterBox!.height).toBeGreaterThanOrEqual(44);
      expect(filterBox!.y + filterBox!.height).toBeLessThanOrEqual(navBox!.y);

      await openDialog(page, filterButton);
    }
    expect(consoleErrors.filter((message) => /__name is not defined/i.test(message))).toEqual([]);
    expect(pageErrors.filter((message) => /__name is not defined/i.test(message))).toEqual([]);
    expect(failedApiResponses).toEqual([]);
  });
});

// From the stub suite's commercial-model.spec.ts: the visitor's pricing page
// (the copy's plan catalogue) and the organisation not-found page. The stub's
// "Save R10" and "Save R50" lines are not checked: the foundation catalogue
// adapter sets no compare-at price (src/lib/commercial/plans.ts), so they
// do not show. Recorded in PORTING.md for the owner.
test.describe("pricing and organisations", () => {
  // Paid plans are paused (the switch takes every plan off sale): the page
  // shows the Individual slot prices with no way to buy, and no old price.
  test("pricing shows the R69 slot prices as opening soon, with nothing to buy", async ({
    page,
  }) => {
    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    const main = page.locator("main");
    await expect(main.getByTestId("retail-offer-month")).toContainText("R69");
    await expect(main.getByTestId("retail-offer-quarter")).toContainText("R207");
    await expect(main.getByTestId("retail-offer-half_year")).toContainText("R414");
    await expect(main.getByTestId("retail-offer-year")).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Opens soon" })).toHaveCount(3);
    for (const button of await main.getByRole("button", { name: "Opens soon" }).all())
      await expect(button).toBeDisabled();
    await expect(main.getByRole("link", { name: /^choose /i })).toHaveCount(0);
    await expect(main.locator('a[href*="/billing/checkout"]')).toHaveCount(0);
    await expect(main).toContainText("Paid slots open soon");
    await expect(main.getByText("Until the event ends")).toBeVisible();
    await expect(main).not.toContainText(
      /Save R|Best value|R50\b|R140|R250|R1,200|R15,000|R650|R450|12 months|Growth|Starter/
    );
  });

  test("the checkout page and route sell nothing while paid plans are paused", async ({
    page,
    request,
  }) => {
    // The first old plan's id from the seeded catalogue (catalogue-identities.json).
    await page.goto("/billing/checkout?plan=00420f8c-0ac1-4828-83c5-d547d862fc8f");
    await expect(page.getByText("Paid slots open soon. Until then, your first post")).toBeVisible();
    const refused = await request.post("/api/billing/create-checkout", {
      data: { planId: "00420f8c-0ac1-4828-83c5-d547d862fc8f" },
    });
    expect([401, 403]).toContain(refused.status());
  });

  test("tourism leads with the free trial above the paid plans", async ({ page }) => {
    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    const main = page.locator("main");
    const trial = main.getByTestId("tourism-free-trial");
    await expect(trial).toHaveCount(0);
    await expect(async () => {
      await main.getByRole("radio", { name: /tourism/i }).click({ timeout: 2_000 });
      await expect(trial).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(trial.getByRole("link", { name: /start free trial/i })).toHaveAttribute(
      "href",
      "/post/create-tourism?type=tourism"
    );
    const trialBox = await trial.boundingBox();
    const planBox = await main.getByTestId("retail-offer-month").boundingBox();
    expect(trialBox!.y).toBeLessThan(planBox!.y);
  });

  test("pricing has no horizontal overflow on phones", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("an unknown organisation shows the not-found page", async ({ page }) => {
    // The root loading boundary streams pages, so notFound() renders with status 200.
    await page.goto("/organisation/not-a-real-organisation");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});

// From the stub suite's mobile-ux-smoke.spec.ts: phone layout checks that need
// no account (its filter-pill checks are the marketplace check above).
test.describe("phone layout", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chrome" && testInfo.project.name !== "mobile-safari",
      "Runs only on mobile projects."
    );
  });

  test("sign-in inputs are comfortable to tap", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    const emailInput = page.getByLabel(/email/i).first();
    await expect(emailInput).toBeVisible();
    const box = await emailInput.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("the bottom tab bar shows on discovery pages and hides on focused flows", async ({
    page,
  }) => {
    const bottomNav = page.getByRole("navigation", { name: "Main", exact: true });
    for (const path of ["/", "/search", "/mzansi-market", "/mzansi-business", "/tourism-events"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(bottomNav, `${path} shows the tab bar`).toBeVisible();
      for (const label of ["Home", "Video", "Post", "Get verified", "Account"])
        await expect(bottomNav.getByRole("link", { name: label, exact: true })).toBeVisible();
      const tabs = bottomNav.getByRole("link");
      for (let index = 0; index < (await tabs.count()); index += 1) {
        const box = await tabs.nth(index).boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }
    // Detail pages, auth and posting keep the screen for their own actions.
    for (const path of ["/login", "/register", "/listing/e2e-missing-listing"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main").first()).toBeVisible();
      await expect(bottomNav, `${path} hides the tab bar`).toHaveCount(0);
    }
  });

  test("footer content is not hidden by the bottom tab bar", async ({ page }) => {
    for (const path of ["/", "/mzansi-market"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      const nav = page.getByRole("navigation", { name: "Main", exact: true });
      await expect(nav).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      for (const footerText of [
        page.getByText("Made in South Africa").first(),
        page
          .locator("footer")
          .getByText(/All rights reserved/i)
          .first(),
      ]) {
        await footerText.scrollIntoViewIfNeeded();
        await expect(footerText).toBeVisible();
        const navTop = await nav.evaluate((el) => el.getBoundingClientRect().top);
        const footerBottom = await footerText.evaluate((el) => el.getBoundingClientRect().bottom);
        expect(footerBottom, `${path} footer clears the tab bar`).toBeLessThanOrEqual(navTop);
      }
    }
  });

  test("the browse page intro leads and the showroom clears the bottom tab bar", async ({
    page,
  }) => {
    await page.goto("/mzansi-market", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    // AreaHero owns the h1 above the showroom.
    await expect(page.getByRole("heading", { level: 1, name: /^mzansi market$/i })).toBeVisible();
    const bottomNav = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(bottomNav).toBeVisible();
    const showroomTitle = page
      .locator('section[aria-roledescription="carousel"] h3:visible')
      .first();
    await showroomTitle.scrollIntoViewIfNeeded();
    await expect(showroomTitle).toBeVisible();
    const headerBottom = await page
      .locator("body header")
      .first()
      .evaluate((el) => el.getBoundingClientRect().bottom);
    const navTop = await bottomNav.evaluate((el) => el.getBoundingClientRect().top);
    const titleRect = await showroomTitle.boundingBox();
    expect(titleRect).not.toBeNull();
    expect(titleRect!.y).toBeGreaterThanOrEqual(headerBottom - 1);
    expect(titleRect!.y + titleRect!.height).toBeLessThanOrEqual(navTop);
  });
});
