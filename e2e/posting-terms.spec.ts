import { expect, test } from "@playwright/test";

test("archived posting terms explain the account and version users accept", async ({ page }) => {
  const response = await page.goto("/terms/versions/posting-v1");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
  await expect(page.getByText("Posting terms · posting-v1", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Acceptance is recorded once per account for each terms version/)
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Related policies" })
      .getByRole("link", { name: "Privacy Policy", exact: true })
  ).toHaveAttribute("href", "/privacy");
});

test("an unpublished terms version is unavailable", async ({ request }) => {
  const response = await request.get("/terms/versions/not-a-published-version");
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain("Acceptance is recorded once per account");
});
