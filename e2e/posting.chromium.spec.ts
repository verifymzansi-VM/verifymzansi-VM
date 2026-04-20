import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { POSTING_CHROMIUM_STATE } from "./auth-state";

const IMAGE_FIXTURE = path.join(process.cwd(), "src", "app", "icon.png");
const RUN_SUFFIX = Date.now().toString().slice(-6);
const BUSINESS_DASHBOARD_URL = /\/dashboard\/(?:listings|businesses)/;
const PROMOTION_DASHBOARD_URL = /\/dashboard\/(?:listings|promotions)/;

test.use({ storageState: POSTING_CHROMIUM_STATE });
test.describe.configure({ mode: "serial" });

function uploaderFor(page: Page, label: RegExp) {
  return page
    .getByText(label)
    .first()
    .locator("xpath=ancestor::*[.//input[@type='file']][1]")
    .locator("input[type='file']")
    .first();
}

function electronicsCategoryLocator(page: Page): Locator {
  return page
    .getByRole("button", { name: /Electronics\s*&\s*Tech/i })
    .or(page.getByRole("radio", { name: /Electronics\s*&\s*Tech/i }))
    .first();
}

async function enterPostingForm(page: Page, firstField: Locator) {
  const startPostingButton = page.getByRole("button", {
    name: /Start Posting|Use Your Free Post/i,
  });

  await Promise.race([
    firstField.waitFor({ state: "visible", timeout: 5_000 }),
    startPostingButton.waitFor({ state: "visible", timeout: 5_000 }),
  ]).catch(() => undefined);

  if (await startPostingButton.isVisible().catch(() => false)) {
    await startPostingButton.click();
  }

  await firstField.waitFor({ state: "visible", timeout: 15_000 });
}

async function discardDraftIfPresent(page: Page) {
  const discardDraftButton = page.getByRole("button", { name: /Discard draft/i });
  if (await discardDraftButton.isVisible().catch(() => false)) {
    page.once("dialog", (dialog) => dialog.accept());
    await discardDraftButton.click();
  }
}

async function expectFirstStepValidationGate(page: Page, route: string, firstField: Locator) {
  await page.goto(route);
  await enterPostingForm(page, firstField);
  await discardDraftIfPresent(page);

  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText(/Please review Step 1/i).first()).toBeVisible();
  await expect(page.getByText(/Please fix\s+\d+\s+field/i).first()).toBeVisible();
  await expect(page.getByText(/Step 1 of/i).first()).toBeVisible();
}

async function completeListingCreate(page: Page) {
  const categoryOption = electronicsCategoryLocator(page);
  await page.goto("/post/create-listing");
  await enterPostingForm(page, categoryOption);
  await categoryOption.click();
  await page.locator('[data-listing-attribute="device_type"]').selectOption("Smartphone");
  await page.locator('[data-listing-attribute="brand"]').fill("Apple");
  await page.getByLabel(/^Title \*$/).fill("Playwright iPhone 15 Pro");
  await page
    .getByLabel(/^Description \*$/)
    .fill("Playwright listing description with enough detail to satisfy the validation rules.");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel(/Price \(ZAR\)/i).fill("18500");
  await page.getByLabel(/^Province/i).selectOption("Gauteng");
  await page.getByLabel(/^City/i).selectOption("Johannesburg");
  await page.getByLabel(/Town \/ Suburb/i).fill("Sandton");
  await page.getByRole("button", { name: "Next" }).click();
  await uploaderFor(page, /^Photos \(max/i).setInputFiles(IMAGE_FIXTURE);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/listings") &&
      response.request().method() === "POST" &&
      response.status() === 201
  );

  await page.getByRole("button", { name: /Submit for review/i }).click();
  await responsePromise;
  await expect(page).toHaveURL(/\/dashboard\/listings/);

  const editLink = page.getByRole("link", { name: /edit/i }).filter({ hasText: /edit/i }).first();
  await editLink.waitFor({ state: "visible", timeout: 15_000 });
  const href = await editLink.getAttribute("href");
  const listingId = href?.split("/").pop();

  expect(listingId).toBeTruthy();
  return listingId as string;
}

async function completeBusinessCreate(page: Page) {
  const businessName = `Playwright Business Studio ${RUN_SUFFIX}`;
  const businessSlug = `playwright-business-studio-${RUN_SUFFIX}`;
  const businessesHeading = page.getByRole("heading", { name: "Mzansi Business" });
  const businessLink = page.getByRole("link", { name: businessName }).first();
  const businessTypeLabel = page
    .locator("label")
    .filter({ hasText: /Standalone Shop|Own Premises/i });
  await page.goto("/post/create-business");
  await enterPostingForm(page, businessTypeLabel);
  await businessTypeLabel.click();
  await page.getByLabel(/Business Name/i).fill(businessName);
  await page.getByLabel(/URL Slug/i).fill(businessSlug);
  await page
    .getByRole("button", { name: /fashion/i })
    .first()
    .click();
  await page.getByLabel(/Street address/i).fill("24 Vilakazi Street");
  await page.getByLabel(/Suburb/i).fill("Orlando West");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel(/Province/i).selectOption("Gauteng");
  await page.getByLabel(/^City(?: \/ Town)?$/i).selectOption("Johannesburg");
  await page.getByRole("button", { name: "Next" }).click();
  await uploaderFor(page, /^Profile photos/i).setInputFiles(IMAGE_FIXTURE);

  const submitButton = page.getByRole("button", { name: /Submit for review/i });
  await Promise.race([
    submitButton.waitFor({ state: "visible", timeout: 15_000 }),
    page.waitForURL(BUSINESS_DASHBOARD_URL, { timeout: 30_000 }),
  ]).catch(() => undefined);

  if (!BUSINESS_DASHBOARD_URL.test(page.url())) {
    await submitButton
      .scrollIntoViewIfNeeded()
      .then(() => submitButton.click())
      .catch(() => undefined);
  }

  await Promise.race([
    page.waitForURL(BUSINESS_DASHBOARD_URL, { timeout: 30_000 }),
    businessesHeading.waitFor({ state: "visible", timeout: 30_000 }),
    businessLink.waitFor({ state: "visible", timeout: 30_000 }),
  ]);

  await businessLink.waitFor({ state: "visible", timeout: 30_000 });
  const businessCard = page.locator("div,article").filter({ has: businessLink }).first();
  const editLink = businessCard.getByRole("link", { name: "Edit" });
  const href = await editLink.getAttribute("href");
  const businessId = href?.split("/").pop();

  expect(businessId).toBeTruthy();
  return { businessId: businessId as string, businessName };
}

async function completePromotionCreate(page: Page) {
  const promotionTitle = `Playwright Weekend Deal ${RUN_SUFFIX}`;
  const eventTypeButton = page.getByRole("button", { name: /Event/i }).first();
  const titleField = page.getByLabel(/Event Title|Title/i);
  await page.goto("/post/create-tourism");
  await enterPostingForm(page, eventTypeButton);
  page.once("dialog", (dialog) => dialog.accept());
  await eventTypeButton.click();
  if (!(await titleField.isVisible().catch(() => false))) {
    const discardDraftButton = page.getByRole("button", { name: /Discard draft/i });
    if (await discardDraftButton.isVisible().catch(() => false)) {
      await discardDraftButton.click();
    }
    page.once("dialog", (dialog) => dialog.accept());
    await eventTypeButton.click();
  }
  await titleField.waitFor({ state: "visible", timeout: 15_000 });
  await page.getByLabel(/Event Type/i).selectOption({ index: 1 });
  await titleField.fill(promotionTitle);
  await page
    .getByLabel(/Event Details|Description/i)
    .fill("Playwright promotion description with enough detail to satisfy the validation rules.");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel(/^Start Date/i).fill("2026-12-15");
  await page.getByLabel(/^End Date/i).fill("2026-12-16");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel(/^Province/i).selectOption("Gauteng");
  await page.getByLabel(/^City(?: \/ Town)?$/i).selectOption("Johannesburg");
  await page.getByRole("button", { name: "Next" }).click();
  await uploaderFor(page, /^Upload photos/i).setInputFiles(IMAGE_FIXTURE);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/promotions") &&
      response.request().method() === "POST" &&
      response.status() === 201
  );

  await page.getByRole("button", { name: /Submit for review/i }).click();
  await responsePromise;
  await expect(page).toHaveURL(PROMOTION_DASHBOARD_URL);
  const editLink = page.getByRole("link", { name: "Edit" }).first();
  const href = await editLink.getAttribute("href");
  const promotionId = href?.split("/").pop();

  expect(promotionId).toBeTruthy();
  return { promotionId: promotionId as string, promotionTitle };
}

test.describe("Posting flows in Chromium", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium" || testInfo.project.name !== "chromium");
  });

  test.setTimeout(120_000);

  test("blocks moving past Step 1 when required fields are missing", async ({ page }) => {
    await expectFirstStepValidationGate(
      page,
      "/post/create-listing",
      electronicsCategoryLocator(page)
    );

    const businessTypeLabel = page
      .locator("label")
      .filter({ hasText: /Standalone Shop|Own Premises/i });
    await expectFirstStepValidationGate(page, "/post/create-business", businessTypeLabel);

    await expectFirstStepValidationGate(
      page,
      "/post/create-promotion",
      page.getByRole("button", { name: "Next" })
    );

    await expectFirstStepValidationGate(
      page,
      "/post/create-tourism",
      page.locator("#listing-type-group")
    );
  });

  test("creates, edits, and publicly exposes a market listing", async ({ page }) => {
    const listingId = await completeListingCreate(page);

    await page.goto("/mzansi-market");
    await expect(
      page.getByRole("heading", { name: "Playwright iPhone 15 Pro" }).first()
    ).toBeVisible();

    await page.goto(`/post/edit-listing/${listingId}`);
    // Wait for existing listing data to populate before editing
    await expect(page.getByLabel(/^Title \*$/)).toHaveValue(/Playwright iPhone 15 Pro/, {
      timeout: 15_000,
    });
    await page.getByLabel(/^Title \*$/).fill("Playwright iPhone 15 Pro Max");
    const updatePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/listings/${listingId}`) &&
        response.request().method() === "PUT"
    );
    await page.getByRole("button", { name: /Save Changes/i }).click();
    const updateResponse = await updatePromise;
    expect(
      updateResponse.ok(),
      `listing update failed with status ${updateResponse.status()}`
    ).toBe(true);
    await expect(page).toHaveURL(/\/dashboard\/listings/);

    await page.goto(`/listing/${listingId}`);
    await expect(
      page.getByRole("heading", { name: "Playwright iPhone 15 Pro Max" }).first()
    ).toBeVisible();
  });

  test("creates, edits, and publicly exposes a business", async ({ page }) => {
    const { businessId, businessName } = await completeBusinessCreate(page);
    const updatedBusinessName = `Playwright Business Collective ${RUN_SUFFIX}`;

    await page.goto("/mzansi-business");
    await expect(page.getByText(businessName).first()).toBeVisible();

    await page.goto(`/post/edit-business/${businessId}`);
    await page.getByLabel(/Business Name/i).fill(updatedBusinessName);
    const updatePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/businesses/${businessId}`) &&
        response.request().method() === "PATCH" &&
        response.ok()
    );
    await page.getByRole("button", { name: /Save Changes/i }).click();
    await updatePromise;
    await expect(page).toHaveURL(BUSINESS_DASHBOARD_URL);

    await page.goto(`/mzansi-business/${businessId}`);
    await expect(page.getByText(updatedBusinessName).first()).toBeVisible();
  });

  test("creates and edits a promotion", async ({ page }) => {
    const { promotionId, promotionTitle } = await completePromotionCreate(page);
    const updatedPromotionTitle = `Playwright Weekend Deal Updated ${RUN_SUFFIX}`;

    await page.goto("/dashboard/tourism-events");
    await expect(page.getByText(promotionTitle).first()).toBeVisible();

    await page.goto(`/post/edit-tourism/${promotionId}`);
    await page.getByLabel(/Event Title|Title/i).fill(updatedPromotionTitle);
    const updatePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/promotions/${promotionId}`) &&
        response.request().method() === "PUT" &&
        response.ok()
    );
    await page.getByRole("button", { name: /Save Changes/i }).click();
    await updatePromise;
    await expect(page).toHaveURL(PROMOTION_DASHBOARD_URL);

    await page.goto("/dashboard/tourism-events");
    await expect(page.getByText(updatedPromotionTitle).first()).toBeVisible();
  });
});
