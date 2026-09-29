import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { eventDateInput } from "./event-dates";

// Representative Market, Tourism and Event journeys from the posting guidance plan.
test.describe.configure({ timeout: 150_000 });

const IMAGE_FIXTURE = path.join(process.cwd(), "src", "app", "icon.png");

function uploaderFor(page: Page, label: RegExp) {
  return page
    .getByText(label)
    .first()
    .locator("xpath=ancestor::*[.//input[@type='file']][1]")
    .locator("input[type='file']")
    .first();
}

async function signIn(page: Page, persona: string) {
  const response = await page.goto(`/api/e2e/auth/session?persona=journey-${persona}&reset=1`);
  expect(response?.ok()).toBe(true);
}

async function enterForm(page: Page, route: string, firstField: ReturnType<Page["getByLabel"]>) {
  await page.goto(route);
  const start = page.getByRole("button", {
    name: /Start Posting|Use Your Free Post|Choose.*days free/i,
  });
  await expect(firstField.or(start).first()).toBeVisible({ timeout: 60_000 });
  if (await start.isVisible()) await start.click();
  await expect(firstField).toBeVisible();
}

const next = (page: Page) => page.getByRole("button", { name: "Next", exact: true }).click();

async function acceptAndSubmit(page: Page, endpoint: string) {
  await page.getByRole("checkbox", { name: /I accept the VerifyMzansi posting terms/i }).check();
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith(endpoint) && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /Submit for review/i }).click();
  const response = await responsePromise;
  expect(response.status(), `POST ${endpoint} returned ${response.status()}`).toBe(201);
  // Navigation after a successful create can detach the body; never wait on it indefinitely.
  return Promise.race([
    response.json().catch(() => ({})),
    new Promise<Record<string, never>>((resolve) => setTimeout(() => resolve({}), 3_000)),
  ]) as Promise<{ id?: string; business?: { id?: string } }>;
}

async function marketBasics(page: Page, category: RegExp, title: string) {
  await enterForm(
    page,
    "/post/create-listing",
    page.getByRole("button", { name: category }).first()
  );
  await page.getByRole("button", { name: category }).first().click();
  return async () => {
    await page.getByLabel(/^Title/).fill(title);
    await page
      .getByLabel(/^Description/)
      .fill("A clear description with enough detail for buyers to understand the listing.");
    await next(page);
  };
}

async function marketLocation(page: Page) {
  await page.getByLabel(/^Province/i).selectOption("Gauteng");
  await page.getByLabel(/^City/i).selectOption("Johannesburg");
}

test.describe("Market journeys", () => {
  test("car listing", async ({ page }) => {
    await signIn(page, "car");
    const finish = await marketBasics(page, /^Vehicles/, "2019 Toyota Corolla Quest");
    await page.locator('[data-listing-attribute="make"]').selectOption("Toyota");
    await page.locator('[data-listing-attribute="model"]').selectOption({ index: 1 });
    await page.locator('[data-listing-attribute="year"]').fill("2019");
    await page.locator('[data-listing-attribute="mileage_km"]').fill("85000");
    await page.locator('[data-listing-attribute="transmission"]').selectOption("manual");
    await page.locator('[data-listing-attribute="fuel_type"]').selectOption("petrol");
    await page.locator('[data-listing-attribute="service_history"]').selectOption("full");
    await finish();
    await page.getByLabel(/^Asking price/).fill("189000");
    await marketLocation(page);
    await next(page);
    await uploaderFor(page, /^Photos \(max/i).setInputFiles(IMAGE_FIXTURE);
    await acceptAndSubmit(page, "/api/listings");
  });

  test("rental property asks for rent once", async ({ page }) => {
    await signIn(page, "rental");
    const finish = await marketBasics(
      page,
      /^Property/,
      "Two-bedroom flat to rent in Braamfontein"
    );
    await page.locator('[data-listing-attribute="property_type"]').selectOption("apartment");
    await page.locator('[data-listing-attribute="listing_intent"]').selectOption("rent");
    await expect(page.locator('[data-listing-attribute="monthly_rent_zar"]')).toHaveCount(0);
    await finish();
    await expect(page.getByLabel(/^Monthly Rent/)).toBeVisible();
    await expect(page.getByLabel(/^Asking price/)).toHaveCount(0);
    await page.getByLabel(/^Monthly Rent/).fill("6500");
    await marketLocation(page);
    await next(page);
    await uploaderFor(page, /^Photos \(max/i).setInputFiles(IMAGE_FIXTURE);
    await acceptAndSubmit(page, "/api/listings");
  });

  test("job without salary or photo", async ({ page }) => {
    await signIn(page, "job");
    const title = `Weekend shop assistant ${Date.now().toString().slice(-5)}`;
    const finish = await marketBasics(page, /^Jobs/, title);
    await expect(page.getByRole("link", { name: "business profile" })).toBeVisible();
    await expect(page.getByLabel(/^Condition/)).toHaveCount(0);
    await page.locator('[data-listing-attribute="job_type"]').selectOption("part_time");
    await page.locator('[data-listing-attribute="location_type"]').selectOption("on_site");
    await finish();
    await expect(page.getByLabel(/^Salary \(ZAR\) \(Optional\)/)).toHaveValue("");
    await expect(page.getByText("Negotiable", { exact: true })).toHaveCount(0);
    await marketLocation(page);
    await next(page);
    await acceptAndSubmit(page, "/api/listings");
    await expect(page).toHaveURL(/\/dashboard\/listings/);
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByText(/^R\s?0(\.00)?$/)).toHaveCount(0);
    const viewHref = await page.getByRole("link", { name: /^View/ }).first().getAttribute("href");
    await page.goto(viewHref ?? "/mzansi-market");
    await expect(page.getByText("Salary not provided").first()).toBeVisible();
  });
});

async function tourismBasics(page: Page, persona: string, subcategory: string, name: string) {
  await signIn(page, persona);
  await enterForm(
    page,
    "/post/create-tourism?type=tourism_business",
    page.getByLabel(/^Business Name/)
  );
  await page.getByLabel(/^Business Name/).fill(name);
  await page
    .getByLabel(/^Description/)
    .fill("Welcoming visitors with a clear description of what they can expect here.");
  await page.getByLabel(/^Tourism category/).selectOption(subcategory);
}

async function tourismContactAndSubmit(page: Page) {
  await page.getByLabel("Phone Call").uncheck();
  await page.getByLabel("Contact Form").check();
  await next(page);
  await uploaderFor(page, /^Upload photos/i).setInputFiles(IMAGE_FIXTURE);
  return acceptAndSubmit(page, "/api/businesses");
}

test.describe("Tourism journeys", () => {
  test("self-catering stay explains the choice and never defaults a grading", async ({ page }) => {
    await tourismBasics(page, "self-catering", "self_catering", "Karoo Stoep Cottage");
    await expect(page.getByText(/guests have facilities to prepare their own meals/)).toBeVisible();
    await next(page);
    await expect(page.getByLabel(/^Official star grading/)).toHaveValue("");
    await next(page);
    await page.getByLabel(/^Province/i).selectOption("Western Cape");
    await page.getByLabel(/^City/i).selectOption({ index: 1 });
    await page.getByLabel(/^Town \/ Suburb/).fill("Prince Albert");
    await page.getByLabel(/^Detailed address/).fill("12 Church Street");
    await tourismContactAndSubmit(page);
  });

  test("guided tour uses a meeting point instead of an office address", async ({ page }) => {
    await tourismBasics(page, "guided-tour", "tour_operator", "Soweto Heritage Walk");
    await next(page);
    await next(page);
    await page.getByLabel(/^Province/i).selectOption("Gauteng");
    await page.getByLabel(/^City/i).selectOption("Johannesburg");
    await next(page);
    await expect(
      page.locator(".inline-form-error", { hasText: "Choose at least one way visitors join you." })
    ).toBeVisible();
    await page.getByRole("checkbox", { name: /At a meeting point/ }).check();
    await page.getByLabel(/^Meeting point/).fill("Outside the Hector Pieterson Museum");
    const created = await tourismContactAndSubmit(page);
    const id = created.business?.id ?? created.id;
    if (id) {
      const saved = await (await page.request.get(`/api/businesses/${id}`)).json();
      expect(JSON.stringify(saved)).toContain("Hector Pieterson Museum");
    }
  });
});

async function eventBasics(page: Page, persona: string, name: string) {
  await signIn(page, persona);
  await enterForm(page, "/post/create-tourism?type=event", page.getByLabel(/^Event name/));
  await expect(page.locator("#listing-type-group")).toHaveCount(0);
  await page.getByLabel(/^Event name/).fill(name);
  await page.getByLabel(/^Event category/).selectOption("workshop_masterclass");
  await expect(page.getByText(/baking workshop or photography class/)).toBeVisible();
  await page
    .getByLabel(/^Description/)
    .fill("A hands-on session with everything you need to take part provided on the day.");
  await next(page);
  await page.getByLabel(/^Start date/).fill(eventDateInput());
  await page.getByLabel(/^Start time/).fill("10:00");
}

async function eventFinish(page: Page) {
  await next(page);
  await expect(page.getByText(/use the number on your VerifyMzansi account/)).toBeVisible();
  await expect(page.locator("#whatsapp")).toHaveCount(0);
  await page.getByLabel(/^Province/i).selectOption("Gauteng");
  await page.getByLabel(/^City/i).selectOption("Johannesburg");
  await next(page);
  await uploaderFor(page, /^Upload photos/i).setInputFiles(IMAGE_FIXTURE);
  return acceptAndSubmit(page, "/api/promotions");
}

test.describe("Event journeys", () => {
  test("free event", async ({ page }) => {
    await eventBasics(page, "free-event", "Community Bread Baking Workshop");
    await page.getByLabel("Free entry").check();
    await expect(page.getByLabel(/^Starting entry price/)).toHaveCount(0);
    await eventFinish(page);
  });

  test("paid event requires a starting price", async ({ page }) => {
    await eventBasics(page, "paid-event", "Evening Photography Masterclass");
    await page.getByLabel("Paid entry").check();
    await next(page);
    await expect(page.getByLabel(/^Starting entry price/)).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel(/^Starting entry price/).fill("150");
    await eventFinish(page);
  });
});

test.describe("Enlarged text on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("help and fields stay in the page flow at 200% text", async ({ page }) => {
    await signIn(page, "large-text");
    await enterForm(page, "/post/create-business", page.getByLabel(/^Business Name/));
    // CSP blocks injected stylesheets; CSSOM changes emulate a 200% browser text setting.
    await page.evaluate(() =>
      document.documentElement.style.setProperty("font-size", "200%", "important")
    );
    const help = page.getByRole("button", { name: "Help with business category" });
    await help.scrollIntoViewIfNeeded();
    await help.click();
    await expect(help).toHaveAttribute("aria-expanded", "true");
    const panelId = await help.getAttribute("aria-controls");
    const panel = page.locator(`[id="${panelId}"]`);
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toBeInViewport();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath("large-text-help.png"), fullPage: false });
  });
});
