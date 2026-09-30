import { expect, test } from "@playwright/test";

// Failure injection checks browser recovery against the local deterministic
// server. Provider authentication and email delivery are verified separately.
test("confirmation destination survives a failed login and successful retry", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/auth/login", async (route) => {
    attempts += 1;
    if (attempts === 1) return route.abort("failed");
    await route.fulfill({ status: 200, json: { success: true } });
  });
  await page.goto("/login?confirmed=true&returnUrl=%2Fmzansi-market");
  await expect(page.getByText("Email confirmed!", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fmzansi-market$/);
  await page.getByLabel("Email", { exact: true }).fill("recovery@example.com");
  await page.getByLabel("Password", { exact: true }).fill("StrongPass123!");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page.getByText("Something went wrong", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("recovery@example.com");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("StrongPass123!");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page).toHaveURL(/\/mzansi-market$/);
  expect(attempts).toBe(2);
});

test("password recovery retries an outage, retains input, and recognizes an expired session", async ({
  page,
}) => {
  let checks = 0;
  let submissions = 0;
  await page.route("**/api/auth/reset-password", async (route) => {
    if (route.request().method() === "GET") {
      checks += 1;
      await route.fulfill({ status: checks === 1 ? 503 : 200, json: { valid: checks > 1 } });
      return;
    }
    submissions += 1;
    if (submissions === 1) return route.abort("failed");
    await route.fulfill({ status: 401, json: { error: "Recovery session expired" } });
  });
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: "Couldn't check your link" })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.getByLabel("New password", { exact: true }).fill("StrongPass123!");
  await page.getByLabel("Confirm password", { exact: true }).fill("StrongPass123!");
  await page.getByRole("button", { name: "Save password", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "We couldn't save your new password" })
  ).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toHaveValue("StrongPass123!");
  await page.getByRole("button", { name: "Save password", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reset link expired" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
    "href",
    "/forgot-password"
  );
  expect(checks).toBe(2);
  expect(submissions).toBe(2);
});
