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
