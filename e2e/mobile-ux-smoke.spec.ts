import { expect, test, type Page } from "@playwright/test";

function isMobileProject(projectName: string): boolean {
  return projectName === "mobile-chrome" || projectName === "mobile-safari";
}

async function openAuthenticatedBilling(page: Page) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const sessionResponse = await page.goto(
      "/api/e2e/auth/session?persona=billing-payment&reset=1",
      {
        waitUntil: "networkidle",
      }
    );
    expect(sessionResponse?.ok()).toBeTruthy();

    await page.goto("/billing", { waitUntil: "networkidle" });

    const redirectedToAuth = /\/(login|sign-in)(\?|$)/i.test(new URL(page.url()).pathname);
    if (!redirectedToAuth) {
      return;
    }

    if (attempt === maxAttempts) {
      await expect(page).not.toHaveURL(/\/(login|sign-in)(\?|$)/i);
      return;
    }
  }
}

async function getRect(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      };
    });
}

async function collectVisibleHrefs(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((elements) => {
    return elements
      .filter((element) => {
        const node = element as HTMLElement;
        const style = window.getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => element.getAttribute("href"))
      .filter((href): href is string => typeof href === "string" && href.length > 0);
  });
}

test.describe("Mobile UX smoke", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!isMobileProject(testInfo.project.name), "Runs only on mobile projects.");
  });

  test("homepage spotlight controls have touch-friendly tap targets", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    // The homepage leads with the hero; the Spotlight showroom only renders when it has items.
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Buy, sell and discover with people you can trust.",
      })
    ).toBeVisible();

    const spotlight = page.locator('main section[aria-roledescription="carousel"]').first();
    if ((await spotlight.count()) === 0) {
      test.skip(true, "Spotlight showroom is hidden because it has no items in this run.");
    }

    const slideButton = spotlight.getByRole("button", { name: /go to slide/i }).first();
    if ((await slideButton.count()) === 0) {
      test.skip(true, "Spotlight renders a single slide, so dot controls are absent.");
    }
    await slideButton.scrollIntoViewIfNeeded();
    await expect(slideButton).toBeVisible();

    const box = await slideButton.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(32);
    expect(box!.height).toBeGreaterThanOrEqual(32);
  });

  test("login inputs remain comfortable to tap on mobile", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const emailInput = page.getByLabel(/email/i).first();
    await expect(emailInput).toBeVisible();

    const box = await emailInput.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("bottom tab bar shows on discovery pages and hides on focused flows", async ({ page }) => {
    const bottomNav = page.getByRole("navigation", { name: "Main", exact: true });

    for (const path of ["/", "/search", "/mzansi-market", "/mzansi-business", "/tourism-events"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(bottomNav, `${path} shows the tab bar`).toBeVisible();
      for (const label of ["Home", "Search", "Post", "Verify", "Account"]) {
        await expect(bottomNav.getByRole("link", { name: label, exact: true })).toBeVisible();
      }
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

  test("footer content is not obscured by fixed bottom navigation", async ({ page }) => {
    for (const path of ["/", "/mzansi-market"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});

      const nav = page.locator('nav[aria-label="Main"]');
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

        const navRect = await getRect(page, 'nav[aria-label="Main"]');
        const footerRect = await footerText.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        });

        expect(footerRect.bottom, `${path} footer clears the tab bar`).toBeLessThanOrEqual(
          navRect.top
        );
      }
    }
  });

  test("browse page intro leads and the showroom clears the bottom tab bar", async ({ page }) => {
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

    const headerRect = await getRect(page, "body header");
    const navRect = await getRect(page, 'nav[aria-label="Main"]');
    const titleRect = await showroomTitle.boundingBox();
    expect(titleRect).not.toBeNull();
    expect(titleRect!.y).toBeGreaterThanOrEqual(headerRect.bottom - 1);
    expect(titleRect!.y + titleRect!.height).toBeLessThanOrEqual(navRect.top);
  });

  for (const filterCheck of [
    {
      name: "listing",
      path: "/mzansi-market",
      createLink: /new post/i,
      buttonLabel: "Open listing filters",
      drawerHeading: { name: "Filters" as string | RegExp },
    },
    {
      name: "promotion",
      path: "/tourism-events",
      createLink: /create event/i,
      buttonLabel: "Open tourism and events filters",
      drawerHeading: { name: /filter tourism & events/i as string | RegExp },
    },
  ]) {
    test(`${filterCheck.name} filter pill is touch-friendly, clear of the tab bar and opens the drawer`, async ({
      page,
    }) => {
      await page.goto(filterCheck.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});

      const createButton = page.getByRole("link", { name: filterCheck.createLink }).first();
      if ((await createButton.count()) > 0) {
        await expect(createButton).toBeVisible();
        const createBox = await createButton.boundingBox();
        expect(createBox).not.toBeNull();
        expect(createBox!.height).toBeGreaterThanOrEqual(44);
      }

      const pill = page.locator(`button[aria-label="${filterCheck.buttonLabel}"]:visible`).last();
      await expect(pill).toBeVisible();
      await expect(pill).toBeEnabled();
      // A labelled pill, not an icon-only FAB.
      await expect(pill).toContainText("Filters");

      await expect
        .poll(async () => (await pill.boundingBox())?.width ?? 0)
        .toBeGreaterThanOrEqual(44);
      await expect
        .poll(async () => (await pill.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(44);

      // It floats above the bottom tab bar instead of covering it.
      const bottomNav = page.getByRole("navigation", { name: "Main", exact: true });
      await expect(bottomNav).toBeVisible();
      const pillRect = await pill.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      });
      const navRect = await getRect(page, 'nav[aria-label="Main"]');
      expect(pillRect.bottom).toBeLessThanOrEqual(navRect.top);

      await pill.click();
      await expect(page.getByRole("heading", filterCheck.drawerHeading)).toBeVisible();
    });
  }

  test("billing section picker and plan CTA remain mobile-friendly", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile-safari",
      "Mobile Safari auth bootstrap is unreliable in CI harness for billing persona flows."
    );

    await openAuthenticatedBilling(page);

    await expect(page.getByRole("heading", { name: /^choose your plan$/i })).toBeVisible();

    const tabs = [
      page.getByRole("radio", { name: /market/i }),
      page.getByRole("radio", { name: /business/i }),
      page.getByRole("radio", { name: /tourism/i }),
    ];

    for (const tab of tabs) {
      await expect(tab).toBeVisible();
      const box = await tab.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await tab.click();
    }

    const cta = page.getByRole("link", { name: /choose 30 days/i }).first();
    await expect(cta).toBeVisible();
    const ctaBox = await cta.boundingBox();
    expect(ctaBox).not.toBeNull();
    expect(ctaBox!.height).toBeGreaterThanOrEqual(44);
  });

  test("promotion detail action controls stay touch-friendly", async ({ page }) => {
    await page.goto("/tourism-events", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const promotionHrefs = await collectVisibleHrefs(page, 'a[href^="/tourism-events/"]');
    if (promotionHrefs.length === 0) {
      test.skip(true, "No promotion links available in current fixture data.");
    }

    let openedPromotionWithActions = false;
    const maxPromotionCandidates = Math.min(promotionHrefs.length, 8);

    for (let index = 0; index < maxPromotionCandidates; index += 1) {
      const href = promotionHrefs[index];

      await page.goto(href, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});

      const shareCount = await page.getByRole("button", { name: /^share$|link copied!/i }).count();
      const reportCount = await page.getByRole("button", { name: /^report$/i }).count();
      if (shareCount > 0 && reportCount > 0) {
        openedPromotionWithActions = true;
        break;
      }
    }

    if (!openedPromotionWithActions) {
      test.skip(true, "Could not find a promotion detail page with contact actions.");
    }

    const shareButton = page.getByRole("button", { name: /^share$|link copied!/i }).first();
    const reportButton = page.getByRole("button", { name: /^report$/i }).first();

    await shareButton.scrollIntoViewIfNeeded();
    await reportButton.scrollIntoViewIfNeeded();
    await expect(shareButton).toBeVisible();
    await expect(reportButton).toBeVisible();

    const shareBox = await shareButton.boundingBox();
    const reportBox = await reportButton.boundingBox();
    expect(shareBox).not.toBeNull();
    expect(reportBox).not.toBeNull();
    expect(shareBox!.height).toBeGreaterThanOrEqual(44);
    expect(reportBox!.height).toBeGreaterThanOrEqual(44);

    await reportButton.click();
    await expect(page.getByRole("heading", { name: /report promotion/i })).toBeVisible();

    const reasonSelect = page.getByLabel(/reason/i).first();
    await expect(reasonSelect).toBeVisible();
    const reasonBox = await reasonSelect.boundingBox();
    expect(reasonBox).not.toBeNull();
    // Native selects can render slightly under 44px depending on the browser shell.
    expect(reasonBox!.height).toBeGreaterThanOrEqual(40);
  });

  test("dsar request controls remain touch-friendly", async ({ page }) => {
    await page.goto("/dsar", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const redirectedToAuth = /\/(login|sign-in)(\?|$)/i.test(new URL(page.url()).pathname);
    if (redirectedToAuth) {
      test.skip(true, "DSAR route requires auth in this harness run.");
    }

    const requestType = page.locator('form button[type="button"]').first();
    await expect(requestType).toBeVisible();
    const requestTypeBox = await requestType.boundingBox();
    expect(requestTypeBox).not.toBeNull();
    expect(requestTypeBox!.height).toBeGreaterThanOrEqual(44);

    const submitButton = page.getByRole("button", { name: /submit request/i }).first();
    await expect(submitButton).toBeVisible();
    const submitBox = await submitButton.boundingBox();
    expect(submitBox).not.toBeNull();
    expect(submitBox!.height).toBeGreaterThanOrEqual(44);
  });

  test("listing detail action controls stay touch-friendly", async ({ page }) => {
    await page.goto("/mzansi-market", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const listingHrefs = await collectVisibleHrefs(page, 'a[href^="/listing/"]');
    if (listingHrefs.length === 0) {
      test.skip(true, "No listing links available in current fixture data.");
    }

    let openedLiveListingWithActions = false;
    const maxCandidates = Math.min(listingHrefs.length, 8);
    for (let index = 0; index < maxCandidates; index += 1) {
      const href = listingHrefs[index];

      await page.goto(href, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});

      const notFoundHeading = page.getByRole("heading", { name: /listing not found/i });
      if ((await notFoundHeading.count()) > 0) continue;

      const shareCount = await page.getByRole("button", { name: /^share$|link copied!/i }).count();
      const reportCount = await page.getByRole("button", { name: /^report$/i }).count();
      if (shareCount > 0 && reportCount > 0) {
        openedLiveListingWithActions = true;
        break;
      }
    }

    if (!openedLiveListingWithActions) {
      test.skip(true, "Could not find a live listing detail page with contact actions.");
    }

    const shareButton = page.getByRole("button", { name: /^share$|link copied!/i }).first();
    const reportButton = page.getByRole("button", { name: /^report$/i }).first();

    await shareButton.scrollIntoViewIfNeeded();
    await reportButton.scrollIntoViewIfNeeded();
    await expect(shareButton).toBeVisible();
    await expect(reportButton).toBeVisible();

    const shareBox = await shareButton.boundingBox();
    const reportBox = await reportButton.boundingBox();
    expect(shareBox).not.toBeNull();
    expect(reportBox).not.toBeNull();
    expect(shareBox!.height).toBeGreaterThanOrEqual(44);
    expect(reportBox!.height).toBeGreaterThanOrEqual(44);

    await reportButton.click();
    await expect(page.getByRole("heading", { name: /report listing/i })).toBeVisible();

    const reasonSelect = page.getByLabel(/reason/i).first();
    await expect(reasonSelect).toBeVisible();
    const reasonBox = await reasonSelect.boundingBox();
    expect(reasonBox).not.toBeNull();
    // Native selects can render slightly under 44px depending on the browser shell.
    expect(reasonBox!.height).toBeGreaterThanOrEqual(40);
  });
});
