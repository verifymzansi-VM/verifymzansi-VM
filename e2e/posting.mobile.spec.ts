import path from "node:path";
import { test, type Locator, type Page } from "@playwright/test";
import { POSTING_MOBILE_STATE } from "./auth-state";
import { eventDateInput } from "./event-dates";

const IMAGE_FIXTURE = path.join(process.cwd(), "src", "app", "icon.png");
const RUN_SUFFIX = Date.now().toString().slice(-6);
const BUSINESS_DASHBOARD_URL = /\/dashboard\/(?:listings|businesses)/;
const PROMOTION_DASHBOARD_URL = /\/dashboard\/(?:listings|promotions)/;

test.use({ storageState: POSTING_MOBILE_STATE });
test.describe.configure({ mode: "serial" });

function uploaderFor(page: Page, label: RegExp) {
  return page
    .getByText(label)
    .first()
    .locator("xpath=ancestor::*[.//input[@type='file']][1]")
    .locator("input[type='file']")
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

function electronicsCategoryLocator(page: Page): Locator {
  return page
    .getByRole("button", { name: /Electronics\s*&\s*Tech/i })
    .or(page.getByRole("radio", { name: /Electronics\s*&\s*Tech/i }))
    .first();
}

async function completeSubmission(page: Page, dashboardPath: RegExp, headingName: string | RegExp) {
  const submitButton = page.getByRole("button", { name: /Submit for review/i });
  const dashboardHeading = page.getByRole("heading", { name: headingName });

  await Promise.race([
    submitButton.waitFor({ state: "visible", timeout: 15_000 }),
    page.waitForURL(dashboardPath, { timeout: 30_000 }),
  ]).catch(() => undefined);

  if (!dashboardPath.test(page.url())) {
    await submitButton
      .scrollIntoViewIfNeeded()
      .then(() => submitButton.click())
      .catch(() => undefined);
  }

  await Promise.race([
    page.waitForURL(dashboardPath, { timeout: 30_000 }),
    dashboardHeading.waitFor({ state: "visible", timeout: 30_000 }),
  ]);
}

async function completeMobileListingCreate(page: Page) {
  const listingTitle = `Mobile Chrome Listing ${RUN_SUFFIX}`;
  const categoryOption = electronicsCategoryLocator(page);

  await page.goto("/post/create-listing");
  await enterPostingForm(page, categoryOption);
  await categoryOption.click();
  await page.locator('[data-listing-attribute="device_type"]').selectOption("Smartphone");
  await page.locator('[data-listing-attribute="brand"]').fill("Samsung");
  await page.getByLabel(/^Title/).fill(listingTitle);
  await page
    .getByLabel(/^Description/)
    .fill("Mobile Chrome listing description with enough detail for the validation rules.");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel(/^Asking price/i).fill("9999");
  await page.getByLabel(/^Province/i).selectOption("Gauteng");
  await page.getByLabel(/^City/i).selectOption("Johannesburg");
  await page.getByRole("button", { name: "Next" }).click();
  await uploaderFor(page, /^Photos \(max/i).setInputFiles(IMAGE_FIXTURE);
  await page.getByRole("checkbox", { name: /I accept the VerifyMzansi posting terms/i }).check();
  await completeSubmission(page, /\/dashboard\/listings/, "My Listings");
}

async function completeMobileBusinessCreate(page: Page) {
  const businessName = `Mobile Chrome Business ${RUN_SUFFIX}`;
  const nameField = page.getByLabel(/^Business Name/);

  await page.goto("/post/create-business");
  await enterPostingForm(page, nameField);
  await nameField.fill(businessName);
  await page
    .getByLabel(/^About Your Business/)
    .fill("A mobile Playwright e2e test business with enough detail to satisfy validation.");
  await page.getByRole("button", { name: /^Clothing/ }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("checkbox", { name: "Customers visit me", exact: true }).check();
  await page.getByLabel(/^Where do customers visit you/).selectOption("standalone_shop");
  await page.getByLabel("Province", { exact: true }).selectOption("Gauteng");
  await page.getByLabel("City or town", { exact: true }).selectOption("Johannesburg");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("checkbox", { name: "Email", exact: true }).check();
  await page.getByLabel(/^Email Address/).fill("owner@example.com");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await uploaderFor(page, /^Profile photos/i).setInputFiles(IMAGE_FIXTURE);
  await page.getByRole("checkbox", { name: /I accept the VerifyMzansi posting terms/i }).check();
  await completeSubmission(page, BUSINESS_DASHBOARD_URL, /^Your Content$|^Mzansi Business$/i);
}

async function completeMobilePromotionCreate(page: Page) {
  const promotionTitle = `Mobile Chrome Promotion ${RUN_SUFFIX}`;
  const titleField = page.getByLabel(/^Event name/);

  await page.goto("/post/create-tourism?type=event");
  await enterPostingForm(page, titleField);
  await titleField.fill(promotionTitle);
  await page.getByLabel(/^Event category/).selectOption({ index: 1 });
  await page
    .getByLabel(/^Description/)
    .fill("Mobile Chrome promotion description with enough detail for the validation rules.");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel(/^Start date/).fill(eventDateInput());
  await page.getByLabel(/^Start time/).fill("18:00");
  await page.getByLabel("Free entry").check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel(/^Province/i).selectOption("Gauteng");
  await page.getByLabel(/^City/i).selectOption("Johannesburg");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await uploaderFor(page, /^Upload photos/i).setInputFiles(IMAGE_FIXTURE);
  await page.getByRole("checkbox", { name: /I accept the VerifyMzansi posting terms/i }).check();
  await completeSubmission(page, PROMOTION_DASHBOARD_URL, /^Your Content$|^Tourism & Events$/i);
}

test.describe("Posting flows on mobile Chrome", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome");
  });

  test.setTimeout(120_000);

  test("creates one market listing", async ({ page }) => {
    await completeMobileListingCreate(page);
  });

  test("creates one business", async ({ page }) => {
    await completeMobileBusinessCreate(page);
  });

  test("creates one promotion", async ({ page }) => {
    await completeMobilePromotionCreate(page);
  });
});
