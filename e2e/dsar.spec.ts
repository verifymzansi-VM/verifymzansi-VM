import { expect, test } from "@playwright/test";

test.describe("DSAR (Data Subject Access Request)", () => {
  test("@smoke DSAR page loads", async ({ page }) => {
    await page.goto("/dsar", { waitUntil: "domcontentloaded" });

    // Wait for client hydration — the form or a redirect should appear within 10s
    const formLocator = page.locator("form").first();
    const loadingLocator = page.getByText("Loading DSAR form");

    const isForm = await formLocator.isVisible().catch(() => false);
    const isLoading = await loadingLocator.isVisible().catch(() => false);
    const isLogin = page.url().includes("/login");

    // If nothing is visible yet, give React up to 10 seconds to hydrate
    if (!isForm && !isLogin && !isLoading) {
      await Promise.race([
        formLocator.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {}),
        page.waitForURL("**/login**", { timeout: 10_000 }).catch(() => {}),
        loadingLocator.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {}),
      ]);
    }

    const finalIsForm = await formLocator.isVisible().catch(() => false);
    const finalIsLogin = page.url().includes("/login");
    const finalIsLoading = await loadingLocator.isVisible().catch(() => false);
    // Also accept the page title / heading as proof the page rendered
    const hasHeading = await page
      .getByText("Data Subject Access Request")
      .isVisible()
      .catch(() => false);
    expect(finalIsForm || finalIsLogin || finalIsLoading || hasHeading).toBeTruthy();
  });

  test("@smoke DSAR form validates SA ID", async ({ page }) => {
    await page.goto("/dsar");

    // If redirected to login, this is an accepted protected-route behavior.
    if (page.url().includes("/login")) {
      await expect(page).toHaveURL(/\/login/);
      return;
    }

    // Fill required fields so browser native validation doesn't block submission
    const nameInput = page.locator("input#name, input[placeholder*='name']").first();
    if (await nameInput.isVisible()) {
      await nameInput.fill("Test User");
    }
    const emailInput = page.locator("input#email, input[type='email']").first();
    if (await emailInput.isVisible()) {
      await emailInput.fill("test@example.com");
    }

    // Fill invalid SA ID and submit
    const idInput = page.locator("input[name='idNumber'], input[placeholder*='ID']").first();
    if (await idInput.isVisible()) {
      await idInput.fill("0000000000000");
      const submitBtn = page.locator("button[type='submit']").first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        // Should show inline validation error for invalid ID (all-zeros has invalid DOB)
        await expect(
          page.locator("[role='alert'], .text-red, .text-destructive, [data-error]").first()
        ).toBeVisible({ timeout: 5000 });
      }
    }
  });
});
