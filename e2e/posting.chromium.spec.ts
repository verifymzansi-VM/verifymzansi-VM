import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { POSTING_CHROMIUM_STATE } from "./auth-state";

const IMAGE_FIXTURE = path.join(process.cwd(), "src", "app", "icon.png");

test.use({ storageState: POSTING_CHROMIUM_STATE });
test.describe.configure({ mode: "serial" });

function uploaderFor(page: Page, label: RegExp) {
  return page
    .locator("div")
    .filter({ has: page.getByText(label) })
    .locator("input[type='file']")
    .first();
}

async function completeListingCreate(page: Page) {
  await page.goto("/post/create-listing");
  await page.getByRole("radio", { name: /Electronics & Tech/i }).click();
  await page.getByLabel(/Device Type/i).selectOption("Smartphone");
  await page.getByLabel(/Brand/i).fill("Apple");
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
  const payload = await (await responsePromise).json();
  await expect(page).toHaveURL(/\/dashboard\/listings/);
  return payload.id as string;
}

async function completeBusinessCreate(page: Page) {
  await page.goto("/post/create-business");
  await page.getByRole("radio", { name: /Standalone Shop/i }).click();
  await page.getByLabel(/Business Name/i).fill("Playwright Business Studio");
  await page.getByLabel(/URL Slug/i).fill("playwright-business-studio");
  await page.getByLabel(/^Category$/).selectOption("fashion_accessories");
  await page.getByLabel(/Street address/i).fill("24 Vilakazi Street");
  await page.getByLabel(/Suburb/i).fill("Orlando West");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel(/Province/i).selectOption("Gauteng");
  await page.getByLabel(/City \/ Town/i).selectOption("Johannesburg");
  await page.getByRole("button", { name: "Next" }).click();
  await uploaderFor(page, /^Profile photos/i).setInputFiles(IMAGE_FIXTURE);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/businesses") &&
      response.request().method() === "POST" &&
      response.status() === 201
  );

  await page.getByRole("button", { name: /Submit for review/i }).click();
  const payload = await (await responsePromise).json();
  await expect(page).toHaveURL(/\/dashboard\/businesses/);
  return payload.business.id as string;
}

async function completePromotionCreate(page: Page) {
  await page.goto("/post/create-promotion");
  await page.getByLabel(/^Title/i).fill("Playwright Weekend Deal");
  await page
    .getByLabel(/Event Details|Description/i)
    .fill("Playwright promotion description with enough detail to satisfy the validation rules.");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel(/^Province/i).selectOption("Gauteng");
  await page.getByLabel(/City \/ Town/i).selectOption("Johannesburg");
  await page.getByRole("button", { name: "Next" }).click();
  await uploaderFor(page, /^Photos \(max/i).setInputFiles(IMAGE_FIXTURE);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/promotions") &&
      response.request().method() === "POST" &&
      response.status() === 201
  );

  await page.getByRole("button", { name: /Submit for review/i }).click();
  const payload = await (await responsePromise).json();
  await expect(page).toHaveURL(/\/dashboard\/promotions/);
  return payload.promotion.id as string;
}

test.describe("Posting flows in Chromium", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium" || testInfo.project.name !== "chromium");
  });

  test("creates, edits, and publicly exposes a market listing", async ({ page }) => {
    const listingId = await completeListingCreate(page);

    await page.goto("/mzansi-market");
    await expect(page.getByText("Playwright iPhone 15 Pro")).toBeVisible();

    await page.goto(`/post/edit-listing/${listingId}`);
    await page.getByLabel(/^Title \*$/).fill("Playwright iPhone 15 Pro Max");
    const updatePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/listings/${listingId}`) &&
        response.request().method() === "PUT" &&
        response.ok()
    );
    await page.getByRole("button", { name: /Save Changes/i }).click();
    await updatePromise;
    await expect(page).toHaveURL(/\/dashboard\/listings/);

    await page.goto(`/listing/${listingId}`);
    await expect(page.getByText("Playwright iPhone 15 Pro Max")).toBeVisible();
  });

  test("creates, edits, and publicly exposes a business", async ({ page }) => {
    const businessId = await completeBusinessCreate(page);

    await page.goto("/mzansi-business");
    await expect(page.getByText("Playwright Business Studio")).toBeVisible();

    await page.goto(`/post/edit-business/${businessId}`);
    await page.getByLabel(/Business Name/i).fill("Playwright Business Collective");
    const updatePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/businesses/${businessId}`) &&
        response.request().method() === "PATCH" &&
        response.ok()
    );
    await page.getByRole("button", { name: /Save Changes/i }).click();
    await updatePromise;
    await expect(page).toHaveURL(/\/dashboard\/businesses/);

    await page.goto(`/mzansi-business/${businessId}`);
    await expect(page.getByText("Playwright Business Collective")).toBeVisible();
  });

  test("creates, edits, and publicly exposes a promotion", async ({ page }) => {
    const promotionId = await completePromotionCreate(page);

    await page.goto("/promotions");
    await expect(page.getByText("Playwright Weekend Deal")).toBeVisible();

    await page.goto(`/post/edit-promotion/${promotionId}`);
    await page.getByLabel(/^Title$/).fill("Playwright Weekend Deal Updated");
    const updatePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/promotions/${promotionId}`) &&
        response.request().method() === "PUT" &&
        response.ok()
    );
    await page.getByRole("button", { name: /Save Changes/i }).click();
    await updatePromise;
    await expect(page).toHaveURL(/\/dashboard\/promotions/);

    await page.goto(`/promotion/${promotionId}`);
    await expect(page.getByText("Playwright Weekend Deal Updated")).toBeVisible();
  });
});
