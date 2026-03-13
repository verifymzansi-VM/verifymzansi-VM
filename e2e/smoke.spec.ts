import { expect, test, type Page } from "@playwright/test";

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
  test("@smoke public and auth pages render without hydration errors", async ({ page }) => {
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

  test("@smoke protected pages redirect unauthenticated users", async ({ page }) => {
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

  test("@smoke webhook endpoints handle malformed payloads without 5xx", async ({ request }) => {
    const payfast = await request.post("/api/webhooks/payfast", {
      form: {
        m_payment_id: "smoke-1",
        payment_status: "COMPLETE",
      },
    });
    expect(payfast.status()).toBeLessThan(500);

    const kyc = await request.post("/api/webhooks/kyc/provider", {
      data: {},
    });
    expect(kyc.status()).toBeLessThan(500);
  });

  test("@smoke mzansi business filters can be cleared from the keyboard", async ({ page }) => {
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
  }) => {
    test.skip((page.viewportSize()?.width ?? 1280) >= 1024, "Mobile-only layout check");

    await page.goto("/mzansi-business");

    const marketplaceTabs = page.getByRole("navigation", { name: "Marketplace areas" });
    const marketTab = marketplaceTabs.getByRole("link", { name: "Mzansi Market" });
    const businessTab = marketplaceTabs.getByRole("link", { name: "Mzansi Business" });
    const promotionsTab = marketplaceTabs.getByRole("link", { name: "Promotions & Events" });

    await expect(marketTab).toBeVisible();
    await expect(businessTab).toBeVisible();
    await expect(promotionsTab).toBeVisible();
    await expect(marketTab).toContainText("Market");
    await expect(businessTab).toContainText("Business");
    await expect(promotionsTab).toContainText("Promotions");

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
  }) => {
    test.skip((page.viewportSize()?.width ?? 1280) >= 1024, "Mobile-only marketplace check");

    const { consoleErrors, pageErrors, failedApiResponses } = collectMarketplacePageErrors(page);
    const pageChecks = [
      {
        path: "/mzansi-market",
        heading: /browse listings/i,
      },
      {
        path: "/mzansi-business",
        heading: /mzansi business/i,
        ctaName: /list your business/i,
        filterButtonName: "Open business filters",
      },
      {
        path: "/promotions",
        heading: /promotions & events/i,
        ctaName: /create a post/i,
        filterButtonName: "Open promotion filters",
      },
    ] as const;

    for (const check of pageChecks) {
      await page.goto(check.path);
      await expect(page.getByRole("heading", { name: check.heading }).first()).toBeVisible();
      await page.waitForTimeout(1_000);

      if (check.ctaName) {
        // Target the PageHeader h1 (not the ShowroomHero h2) and its sibling CTA
        const heading = page.getByRole("heading", { name: check.heading, level: 1 }).first();
        const cta = page.getByRole("link", { name: check.ctaName }).last();

        await expect(cta).toBeVisible();

        const headingBox = await heading.boundingBox();
        const ctaBox = await cta.boundingBox();

        expect(ctaBox?.y ?? 0).toBeGreaterThan((headingBox?.y ?? 0) + (headingBox?.height ?? 0));
      }

      if (check.filterButtonName) {
        const filterButton = page.getByRole("button", { name: check.filterButtonName });
        const bottomNav = page.getByRole("navigation", { name: "Main" });

        await expect(filterButton).toBeVisible();
        await expect(bottomNav).toBeVisible();

        const filterButtonBox = await filterButton.boundingBox();
        const bottomNavBox = await bottomNav.boundingBox();

        expect((filterButtonBox?.y ?? 0) + (filterButtonBox?.height ?? 0)).toBeLessThanOrEqual(
          (bottomNavBox?.y ?? Number.POSITIVE_INFINITY) - 8
        );
      }
    }

    expect(consoleErrors.filter((message) => /__name is not defined/i.test(message))).toEqual([]);
    expect(pageErrors.filter((message) => /__name is not defined/i.test(message))).toEqual([]);
    expect(failedApiResponses).toEqual([]);
  });
});
