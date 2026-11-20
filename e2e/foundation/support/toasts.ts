import { expect, type Locator, type Page } from "@playwright/test";

/** A short phone screen, where a toast near the bottom used to cover a form's button. */
export const SHORT_PHONE = { width: 375, height: 667 } as const;

/**
 * Switches the page to the short phone screen in every project (the desktop
 * chromium lane too, not only the phone lanes) and returns a function that
 * puts the project's own screen size back. Call it before the form is filled,
 * so nothing on the page changes size while a form holds typed values.
 */
export async function switchToShortPhone(page: Page): Promise<() => Promise<void>> {
  const original = page.viewportSize();
  await page.setViewportSize(SHORT_PHONE);
  return async () => {
    if (original) await page.setViewportSize(original);
  };
}

/**
 * Keeps a toast on screen: rests the pointer on it, which pauses its 5-second
 * timer (Radix pauses while the pointer is over a toast; src/components/ui/toast.tsx).
 * Call it as soon as the toast appears, then use `clickWhileToastShows`.
 */
export async function holdToast(toast: Locator) {
  await expect(toast).toBeVisible();
  await toast.hover();
}

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Clicks `button` while `toast` is still on screen, proving the toast does not
 * cover it. The button is brought to the middle of the screen first, then the
 * two boxes on screen are compared: they must not overlap. On a phone toasts
 * sit at the top of the screen, clear of a form's buttons. If the toast
 * covered the button, the click would also land on the toast instead:
 * Playwright would keep retrying with the pointer over the toast, the paused
 * toast would never close, and the click would time out.
 */
export async function clickWhileToastShows(toast: Locator, button: Locator) {
  await expect(toast).toBeVisible();
  // The whole toast card (its list item), also when `toast` is only its title.
  const card = toast.locator("xpath=ancestor-or-self::li[1]");
  await button.evaluate((element) =>
    element.scrollIntoView({ block: "center", behavior: "instant" })
  );
  await expect(button).toBeInViewport();
  // Back on the toast after the scroll, so its timer stays paused while measured.
  await toast.hover();
  await expect
    .poll(
      async () => {
        const [toastBox, buttonBox] = await Promise.all([card.boundingBox(), button.boundingBox()]);
        if (!toastBox || !buttonBox) return "not measured";
        return overlaps(toastBox, buttonBox)
          ? `toast ${JSON.stringify(toastBox)} covers button ${JSON.stringify(buttonBox)}`
          : "clear";
      },
      { message: "the visible toast must not overlap the button", timeout: 3_000 }
    )
    .toBe("clear");
  await expect(toast).toBeVisible();
  await button.click({ timeout: 10_000 });
}
