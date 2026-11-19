import { expect, type Page } from "@playwright/test";

/**
 * Waits until every toast has closed by itself, with the pointer moved off
 * the toast area first.
 *
 * On a phone the toast area sits at the bottom of the screen and can cover a
 * form's button (the iPhone 15 viewport is 393x659). Radix pauses a toast's
 * timer while the pointer moves over it, and a Playwright click moves the
 * pointer onto the covered button and retries there, so the toast never
 * closes and the click never lands. Call this before clicking a button that
 * a toast shown just before may cover. Toasts close after 5 seconds
 * (src/components/ui/toast.tsx, Radix's default duration).
 */
export async function waitForToastsToClose(page: Page) {
  await page.mouse.move(0, 0);
  await expect(
    page.getByRole("region", { name: /^Notifications/ }).locator("li[data-state]")
  ).toHaveCount(0, { timeout: 15_000 });
}
