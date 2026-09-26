import { expect, test } from "@playwright/test";

test("mobile menu preserves scrolling, returns focus, and resets on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const toggle = page.getByTestId("mobile-menu-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByText("Sign in", { exact: true })
    .focus();
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});

test("homepage hero search sends visitors to site search", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Buy, sell and discover with people you can trust.",
    })
  ).toBeVisible();
  // The header search is hidden on the homepage because the hero leads with its own.
  await expect(page.locator("header").getByRole("search")).toHaveCount(0);

  const search = page.locator("main").getByRole("search", { name: "Search VerifyMzansi" });
  const input = search.getByRole("searchbox", { name: "Search VerifyMzansi" });
  // An empty search stays on the page and keeps focus in the field.
  await search.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(input).toBeFocused();

  await input.fill("bakkie");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=bakkie/);
});
