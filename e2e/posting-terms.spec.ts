import { expect, test } from "@playwright/test";

// The site has one set of Terms: former per-version addresses lead to /terms,
// which shows no version name.
test("former per-version Terms addresses lead to the one set of Terms", async ({ page }) => {
  for (const path of ["/terms/versions/posting-v1", "/terms/versions/not-a-published-version"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/terms");
  }
  await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /Slots & prices/ })).toBeVisible();
  await expect(page.getByText(/posting-v\d/)).toHaveCount(0);
});
