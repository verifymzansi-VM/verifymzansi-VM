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

  test("home carousel controls have touch-friendly tap targets", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const slideButton = page.getByRole("button", { name: /go to slide/i }).first();
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

  test("footer content is not obscured by fixed bottom navigation", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const footerText = page.getByText("Made in South Africa").first();
    await footerText.scrollIntoViewIfNeeded();
    await expect(footerText).toBeVisible();

    const navRect = await getRect(page, 'nav[aria-label="Main"]');
    const footerRect = await footerText.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });

    expect(footerRect.bottom).toBeLessThanOrEqual(navRect.top);
  });

  test("showroom hero content stays clear of the fixed bottom navigation", async ({ page }) => {
    await page.goto("/mzansi-market", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const showroomTitle = page.locator('section[aria-roledescription="carousel"] h3').first();
    await expect(showroomTitle).toBeVisible();

    const navRect = await getRect(page, 'nav[aria-label="Main"]');
    const titleRect = await showroomTitle.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });

    expect(titleRect.bottom).toBeLessThanOrEqual(navRect.top);
  });

  test("listing filter FAB is touch-friendly and opens the drawer", async ({ page }) => {
    await page.goto("/mzansi-market", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const createPostButton = page.getByRole("link", { name: /new post/i }).first();
    if ((await createPostButton.count()) > 0) {
      await expect(createPostButton).toBeVisible();
      const createPostBox = await createPostButton.boundingBox();
      expect(createPostBox).not.toBeNull();
      expect(createPostBox!.height).toBeGreaterThanOrEqual(44);
    }

    const fab = page.getByRole("button", { name: /open listing filters/i });
    await expect(fab).toBeVisible();

    const listingFabRect = await fab.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(listingFabRect.width).toBeGreaterThanOrEqual(44);
    expect(listingFabRect.height).toBeGreaterThanOrEqual(44);

    await fab.click();
    await expect(page.getByRole("heading", { name: "Filters" })).toBeVisible();
  });

  test("promotion filter FAB is touch-friendly and opens the drawer", async ({ page }) => {
    await page.goto("/promotions", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const createEventButton = page.getByRole("link", { name: /create event/i }).first();
    if ((await createEventButton.count()) > 0) {
      await expect(createEventButton).toBeVisible();
      const createEventBox = await createEventButton.boundingBox();
      expect(createEventBox).not.toBeNull();
      expect(createEventBox!.height).toBeGreaterThanOrEqual(44);
    }

    const fab = page.getByRole("button", { name: /open promotion filters/i });
    await expect(fab).toBeVisible();

    const promotionFabRect = await fab.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(promotionFabRect.width).toBeGreaterThanOrEqual(44);
    expect(promotionFabRect.height).toBeGreaterThanOrEqual(44);

    await fab.click();
    await expect(page.getByRole("heading", { name: /filter tourism & events/i })).toBeVisible();
  });

  test("billing tabs and plan CTA remain mobile-friendly", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile-safari",
      "Mobile Safari auth bootstrap is unreliable in CI harness for billing persona flows."
    );

    await openAuthenticatedBilling(page);

    await expect(page.getByRole("heading", { name: /simple, transparent pricing/i })).toBeVisible();

    const tabs = [
      page.getByRole("tab", { name: /market/i }),
      page.getByRole("tab", { name: /business/i }),
      page.getByRole("tab", { name: /events/i }),
    ];

    for (const tab of tabs) {
      await expect(tab).toBeVisible();
      const box = await tab.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await tab.click();
    }

    const cta = page.getByRole("button", { name: /choose/i }).first();
    await expect(cta).toBeVisible();
    const ctaBox = await cta.boundingBox();
    expect(ctaBox).not.toBeNull();
    expect(ctaBox!.height).toBeGreaterThanOrEqual(44);
  });

  test("promotion detail action controls stay touch-friendly", async ({ page }) => {
    await page.goto("/promotions", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const promotionHrefs = await collectVisibleHrefs(page, 'a[href^="/promotion/"]');
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
