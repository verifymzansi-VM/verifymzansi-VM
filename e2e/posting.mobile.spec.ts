import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { POSTING_MOBILE_STATE } from "./auth-state";

const IMAGE_FIXTURE = path.join(process.cwd(), "src", "app", "icon.png");

test.use({ storageState: POSTING_MOBILE_STATE });
test.describe.configure({ mode: "serial" });

function uploaderFor(page: Page, label: RegExp) {
  return page
    .locator("div")
    .filter({ has: page.getByText(label) })
    .locator("input[type='file']")
    .first();
}

test.describe("Posting flows on mobile Chrome", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome");
  });

  test("creates one market listing, business, and promotion", async ({ page }) => {
    await page.goto("/post/create-listing");
    await page.getByRole("radio", { name: /Electronics & Tech/i }).click();
    await page.getByLabel(/Device Type/i).selectOption("Smartphone");
    await page.getByLabel(/Brand/i).fill("Samsung");
    await page.getByLabel(/^Title \*$/).fill("Mobile Chrome Listing");
    await page
      .getByLabel(/^Description \*$/)
      .fill("Mobile Chrome listing description with enough detail for the validation rules.");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel(/Price \(ZAR\)/i).fill("9999");
    await page.getByLabel(/^Province/i).selectOption("Gauteng");
    await page.getByLabel(/^City/i).selectOption("Johannesburg");
    await page.getByRole("button", { name: "Next" }).click();
    await uploaderFor(page, /^Photos \(max/i).setInputFiles(IMAGE_FIXTURE);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/listings") &&
          response.request().method() === "POST" &&
          response.status() === 201
      ),
      page.getByRole("button", { name: /Submit for review/i }).click(),
    ]);
    await expect(page).toHaveURL(/\/dashboard\/listings/);

    await page.goto("/post/create-business");
    await page.getByRole("radio", { name: /Standalone Shop/i }).click();
    await page.getByLabel(/Business Name/i).fill("Mobile Chrome Business");
    await page.getByLabel(/URL Slug/i).fill("mobile-chrome-business");
    await page.getByLabel(/^Category$/).selectOption("fashion_accessories");
    await page.getByLabel(/Street address/i).fill("12 Bree Street");
    await page.getByLabel(/Suburb/i).fill("CBD");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel(/Province/i).selectOption("Gauteng");
    await page.getByLabel(/City \/ Town/i).selectOption("Johannesburg");
    await page.getByRole("button", { name: "Next" }).click();
    await uploaderFor(page, /^Profile photos/i).setInputFiles(IMAGE_FIXTURE);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/businesses") &&
          response.request().method() === "POST" &&
          response.status() === 201
      ),
      page.getByRole("button", { name: /Submit for review/i }).click(),
    ]);
    await expect(page).toHaveURL(/\/dashboard\/businesses/);

    await page.goto("/post/create-promotion");
    await page.getByLabel(/^Title/i).fill("Mobile Chrome Promotion");
    await page
      .getByLabel(/Event Details|Description/i)
      .fill("Mobile Chrome promotion description with enough detail for the validation rules.");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel(/^Province/i).selectOption("Gauteng");
    await page.getByLabel(/City \/ Town/i).selectOption("Johannesburg");
    await page.getByRole("button", { name: "Next" }).click();
    await uploaderFor(page, /^Photos \(max/i).setInputFiles(IMAGE_FIXTURE);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/promotions") &&
          response.request().method() === "POST" &&
          response.status() === 201
      ),
      page.getByRole("button", { name: /Submit for review/i }).click(),
    ]);
    await expect(page).toHaveURL(/\/dashboard\/promotions/);
  });
});
