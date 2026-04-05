import path from "node:path";
import { test, type Page } from "@playwright/test";
import { POSTING_MOBILE_STATE } from "./auth-state";

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

async function enterPostingForm(
  page: Page,
  firstField: ReturnType<Page["getByRole"]> | ReturnType<Page["getByLabel"]>
) {
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
  const categoryOption = page.getByRole("radio", { name: /Electronics & Tech/i });

  await page.goto("/post/create-listing");
  await enterPostingForm(page, categoryOption);
  await categoryOption.click();
  await page.getByLabel(/Device Type/i).selectOption("Smartphone");
  await page.getByLabel(/Brand/i).fill("Samsung");
  await page.getByLabel(/^Title \*$/).fill(listingTitle);
  await page
    .getByLabel(/^Description \*$/)
    .fill("Mobile Chrome listing description with enough detail for the validation rules.");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel(/Price \(ZAR\)/i).fill("9999");
  await page.getByLabel(/^Province/i).selectOption("Gauteng");
  await page.getByLabel(/^City/i).selectOption("Johannesburg");
  await page.getByRole("button", { name: "Next" }).click();
  await uploaderFor(page, /^Photos \(max/i).setInputFiles(IMAGE_FIXTURE);
  await completeSubmission(page, /\/dashboard\/listings/, "My Listings");
}

async function completeMobileBusinessCreate(page: Page) {
  const businessName = `Mobile Chrome Business ${RUN_SUFFIX}`;
  const businessSlug = `mobile-chrome-business-${RUN_SUFFIX}`;
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
  await page.getByLabel(/Street address/i).fill("12 Bree Street");
  await page.getByLabel(/Suburb/i).fill("CBD");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel(/Province/i).selectOption("Gauteng");
  await page.getByLabel(/^City(?: \/ Town)?$/i).selectOption("Johannesburg");
  await page.getByRole("button", { name: "Next" }).click();
  await uploaderFor(page, /^Profile photos/i).setInputFiles(IMAGE_FIXTURE);
  await completeSubmission(page, BUSINESS_DASHBOARD_URL, /Your Content|Mzansi Business/i);
}

async function completeMobilePromotionCreate(page: Page) {
  const promotionTitle = `Mobile Chrome Promotion ${RUN_SUFFIX}`;
  const titleField = page.getByLabel(/Event Title|Title/i);

  await page.goto("/post/create-promotion");
  await enterPostingForm(page, titleField);
  await titleField.fill(promotionTitle);
  await page
    .getByLabel(/Event Details|Description/i)
    .fill("Mobile Chrome promotion description with enough detail for the validation rules.");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel(/^Province/i).selectOption("Gauteng");
  await page.getByLabel(/^City(?: \/ Town)?$/i).selectOption("Johannesburg");
  await page.getByRole("button", { name: "Next" }).click();
  await uploaderFor(page, /^Photos \(max/i).setInputFiles(IMAGE_FIXTURE);
  await completeSubmission(page, PROMOTION_DASHBOARD_URL, /Your Content|Tourism & Events/i);
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
