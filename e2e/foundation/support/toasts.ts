import { expect, type Locator } from "@playwright/test";

/**
 * Keeps a toast on screen: rests the pointer on it, which pauses its 5-second
 * timer (Radix pauses while the pointer is over a toast; src/components/ui/toast.tsx).
 * Call it as soon as the toast appears, then use `clickWhileToastShows`.
 */
export async function holdToast(toast: Locator) {
  await expect(toast).toBeVisible();
  await toast.hover();
}

/**
 * Clicks `button` while `toast` is still on screen, proving the toast does not
 * cover it. On a phone toasts sit at the top of the screen, clear of a form's
 * buttons. If the toast covered the button, the click would land on the toast
 * instead: Playwright would keep retrying with the pointer over the toast, the
 * paused toast would never close, and the click would time out.
 */
export async function clickWhileToastShows(toast: Locator, button: Locator) {
  await expect(toast).toBeVisible();
  await button.click({ timeout: 10_000 });
}
