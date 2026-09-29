import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial", timeout: 120_000 });

async function openBusiness(page: Page, name: string, category: string) {
  await page.goto(`/api/e2e/auth/session?persona=guidance-${name}&reset=1`);
  await page.goto("/post/create-business");
  const nameField = page.getByLabel(/^Business Name/);
  const start = page.getByRole("button", {
    name: /Start Posting|Use Your Free Post|Choose.*days free/i,
  });
  await expect(nameField.or(start).first()).toBeVisible({ timeout: 60_000 });
  if (await start.isVisible()) await start.click();
  await nameField.fill(`Guidance ${name}`);
  await page
    .getByLabel(/^About Your Business/)
    .fill("Serving customers in South Africa with personal service.");
  await page.getByRole("button", { name: new RegExp(`^${category}`) }).click();
  const help = page.getByRole("button", { name: "Help with business category" });
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(help).toHaveAttribute("aria-expanded", "true");
  await expect(nameField).toHaveValue(`Guidance ${name}`);
  await page.keyboard.press("Space");
  await expect(help).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Next", exact: true }).click();
}

const journeys = [
  {
    name: "home-salon",
    category: "Beauty",
    methods: ["Customers visit me", "I travel to customers"],
    premises: "home_business",
    travel: "Soweto, Sandton",
  },
  {
    name: "plumber",
    category: "Building",
    methods: ["Customers visit me", "I travel to customers"],
    premises: "standalone_shop",
    travel: "Johannesburg",
  },
  {
    name: "spaza",
    category: "Groceries",
    methods: ["Customers visit me", "I deliver orders"],
    premises: "standalone_shop",
    delivery: "Soweto",
  },
  { name: "consultant", category: "Professional", methods: ["I sell or provide services online"] },
  {
    name: "market-stall",
    category: "Clothing",
    methods: ["Customers visit me"],
    premises: "market_stall",
    venue: "Rosebank Sunday Market",
  },
] as const;

for (const journey of journeys) {
  test(`${journey.name}: optional fields, help, review and submission`, async ({
    page,
  }, testInfo) => {
    await openBusiness(page, journey.name, journey.category);
    for (const method of journey.methods)
      await page.getByRole("checkbox", { name: method, exact: true }).check();
    if ("premises" in journey)
      await page.getByLabel(/^Where do customers visit you/).selectOption(journey.premises);
    if ("travel" in journey) await page.getByLabel(/^Service areas/).fill(journey.travel);
    if ("delivery" in journey) await page.getByLabel(/^Delivery areas/).fill(journey.delivery);
    if ("venue" in journey)
      await page.getByLabel(/^Shopping centre or market name/).fill(journey.venue);
    if (journey.name !== "consultant") {
      await page.getByLabel("Province", { exact: true }).selectOption("Gauteng");
      await page.getByLabel("City or town", { exact: true }).selectOption("Johannesburg");
    }
    if (journey.name === "home-salon") {
      await page.getByLabel("Detailed Address", { exact: true }).fill("PRIVATE TEST ADDRESS 42");
      await expect(
        page.getByRole("checkbox", { name: "Show my exact visitor address publicly" })
      ).not.toBeChecked();
    }
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("checkbox", { name: "Email", exact: true }).check();
    await page.getByLabel(/^Email Address/).fill("owner@example.com");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit about your business" })).toBeVisible();
    await expect(page.getByText("PRIVATE TEST ADDRESS 42")).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`${journey.name}-review.png`),
      fullPage: true,
    });
    await page.getByRole("checkbox", { name: /I accept the VerifyMzansi posting terms/ }).check();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/businesses") && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: /Submit for review/i }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const result = await response.json();
    const id = result.business?.id ?? result.id;
    if (id) {
      const saved = await page.request.get(`/api/businesses/${id}`);
      const publicData = await saved.json();
      expect(JSON.stringify(publicData)).not.toContain("PRIVATE TEST ADDRESS 42");
    }
  });
}
