import { expect, test, type Page } from "@playwright/test";

const WEBKIT_SKIP = ["webkit", "mobile-safari"];

async function signIn(page: Page, persona: string) {
  const response = await page.goto(`/api/e2e/auth/session?persona=${persona}&reset=1`, {
    waitUntil: "networkidle",
  });
  expect(response?.ok()).toBeTruthy();
}

test.describe("Commercial model", () => {
  test("pricing shows the retail ladder, free events and the organisation route", async ({
    page,
  }) => {
    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    const main = page.locator("main");
    await expect(main.getByTestId("retail-offer-month")).toContainText("R50");
    await expect(main.getByTestId("retail-offer-half_year")).toContainText("R250");
    await expect(main.getByTestId("retail-offer-half_year")).toContainText(/most popular/i);
    await expect(main.getByTestId("retail-offer-half_year")).toContainText("Save R50");
    await expect(main.getByTestId("retail-offer-year")).toContainText("R450");
    await expect(main.getByTestId("retail-offer-year")).toContainText(/best value/i);
    await expect(main.getByTestId("retail-offer-year")).toContainText("Save R150");
    await expect(main.getByText("Until the event ends")).toBeVisible();
    await expect(main.getByRole("link", { name: /request a proposal/i })).toHaveAttribute(
      "href",
      "/contact?topic=organisation_proposal"
    );
    await expect(main).not.toContainText(/R650|Growth|Starter/);

    // The section picker changes where the slot is used, not the price.
    const before = await main.getByRole("link", { name: /choose 30 days/i }).getAttribute("href");
    await main.getByRole("radio", { name: /tourism/i }).click();
    const after = await main.getByRole("link", { name: /choose 30 days/i }).getAttribute("href");
    expect(after).not.toBe(before);
    await expect(main.getByTestId("retail-offer-month")).toContainText("R50");
  });

  test("tourism leads with the free trial above the paid plans", async ({ page }, info) => {
    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    const main = page.locator("main");
    await expect(main.getByTestId("tourism-free-trial")).toHaveCount(0);
    await main.getByRole("radio", { name: /tourism/i }).click();
    const trial = main.getByTestId("tourism-free-trial");
    await expect(trial).toBeVisible();
    await expect(trial.getByRole("link", { name: /start free trial/i })).toHaveAttribute(
      "href",
      "/post/create-tourism?type=tourism"
    );
    const trialBox = await trial.boundingBox();
    const planBox = await main.getByTestId("retail-offer-month").boundingBox();
    expect(trialBox!.y).toBeLessThan(planBox!.y);
    await page.screenshot({ path: info.outputPath("tourism-pricing.png"), fullPage: true });
  });

  test("tourism posting offers the trial first, then free events, then plans", async ({
    page,
  }, info) => {
    test.skip(WEBKIT_SKIP.includes(info.project.name), "WebKit auth bootstrap is unreliable.");
    await signIn(page, "billing-payment");
    await page.goto("/post/create-tourism", { waitUntil: "domcontentloaded" });
    const eventOption = page.getByTestId("free-event-option");
    await expect(eventOption).toBeVisible({ timeout: 15_000 });
    const heading = page.getByRole("heading", { name: /choose how you want to post/i });
    const planCard = page.getByRole("button", { name: /choose 30 days/i }).first();
    const [headingBox, eventBox, planBox] = await Promise.all([
      heading.boundingBox(),
      eventOption.boundingBox(),
      planCard.boundingBox(),
    ]);
    expect(headingBox!.y).toBeLessThan(eventBox!.y);
    expect(eventBox!.y).toBeLessThan(planBox!.y);
    await page.screenshot({ path: info.outputPath("tourism-gate.png"), fullPage: true });
    await eventOption.getByRole("button", { name: /create a free event/i }).click();
    await expect(page.getByRole("heading", { name: /create an event/i })).toBeVisible();
  });

  test("pricing has no horizontal overflow on phones", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("checkout confirms dates, slots and renewal before payment", async ({ page }, info) => {
    test.skip(WEBKIT_SKIP.includes(info.project.name), "WebKit auth bootstrap is unreliable.");
    await signIn(page, "billing-payment");
    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: /choose 12 months — mzansi market/i }).click();
    await page.waitForURL("**/billing/checkout?plan=*");
    await expect(page.getByRole("heading", { name: "Confirm your plan" })).toBeVisible();
    await expect(page.getByText("R450").first()).toBeVisible();
    await expect(page.getByText("12 months", { exact: true })).toBeVisible();
    await expect(page.getByText("Does not renew automatically")).toBeVisible();
    await expect(page.getByText(/stay saved in your dashboard/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /pay r450 securely/i })).toBeEnabled();
  });

  test("an unknown plan cannot be checked out", async ({ page }, info) => {
    test.skip(WEBKIT_SKIP.includes(info.project.name), "WebKit auth bootstrap is unreliable.");
    await signIn(page, "billing-payment");
    await page.goto("/billing/checkout?plan=00000000-0000-4000-8000-000000000000");
    await expect(page.getByText(/this plan is not available/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /pay/i })).toHaveCount(0);
  });

  test("unknown or unpublished organisations show the not-found page", async ({ page }) => {
    // The root loading boundary streams pages, so notFound() renders with status 200.
    await page.goto("/organisation/not-a-real-organisation");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("members can open the affiliation page without an organisation", async ({ page }, info) => {
    test.skip(WEBKIT_SKIP.includes(info.project.name), "WebKit auth bootstrap is unreliable.");
    await signIn(page, "billing-payment");
    await page.goto("/dashboard/affiliations", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /organisation affiliations/i }).first()
    ).toBeVisible();
    await expect(page.getByText(/works the same without it/i)).toBeVisible();
  });
});
