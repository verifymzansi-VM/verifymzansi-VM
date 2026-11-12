import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Keyboard, contrast and moving-content checks (roadmap M10.1), shared by the
 * stub suite's e2e/a11y.spec.ts and the foundation suite's a11y spec. They use
 * only test-mode pages (/dev/*) and public pages, and answer the listing feeds
 * themselves where the result must not depend on the data in the copy.
 */

type Rgb = [number, number, number];

function parseRgb(value: string): Rgb {
  const match = value.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (!match) throw new Error(`Not an rgb colour: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG contrast of an element's text colour on its own (solid) background. */
export async function ownContrastRatio(element: Locator): Promise<number> {
  const { color, background } = await element.evaluate((el) => {
    const style = getComputedStyle(el);
    return { color: style.color, background: style.backgroundColor };
  });
  const [lighter, darker] = [luminance(parseRgb(color)), luminance(parseRgb(background))].sort(
    (a, b) => b - a
  );
  return (lighter + 0.05) / (darker + 0.05);
}

/** Opens a dialog from the keyboard, closes it with Escape, and expects focus back on the opener. */
async function expectFocusReturnsAfterEscape(page: Page, opener: Locator) {
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  // The ring shows: focus came back as keyboard focus, not a silent programmatic one.
  expect(await opener.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
}

/** Empty answers from both Tourism & Events feeds, whatever the copy holds. */
async function answerEmptyTourismFeeds(page: Page) {
  await page.route(/\/api\/businesses(\?|$)/, (route) =>
    route.fulfill({ json: { businesses: [], total: 0, page: 1, limit: 24 } })
  );
  await page.route(/\/api\/promotions(\?|$)/, (route) =>
    route.fulfill({
      json: { promotions: [], accountProfiles: [], businesses: [], total: 0, page: 1, limit: 24 },
    })
  );
}

async function expectNoSeriousAxeFindings(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  const serious = violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(serious.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))).toEqual([]);
}

export function registerKeyboardA11yChecks() {
  test.describe("keyboard, contrast and moving content (M10.1)", () => {
    test("contact dialogs give keyboard focus back to the button that opened them", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto("/dev/immersive");
      const enquiry = page.getByRole("button", { name: "Send an enquiry", exact: true });
      await expect(enquiry).toBeVisible();
      await expectFocusReturnsAfterEscape(page, enquiry);
      await expectFocusReturnsAfterEscape(
        page,
        page.getByRole("button", { name: "Report", exact: true })
      );
      await expectFocusReturnsAfterEscape(
        page,
        page.getByRole("group", { name: "Post actions" }).getByRole("button", {
          name: "Message account holder",
        })
      );
    });

    for (const scheme of ["light", "dark"] as const) {
      test(`the selected Events tab has text contrast of at least 4.5:1 (${scheme})`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await answerEmptyTourismFeeds(page);
        await page.goto("/tourism-events?tab=events&type=event");
        const eventsTab = page.locator("#tab-events");
        await expect(eventsTab).toHaveAttribute("aria-selected", "true");
        // Let the tab's colour transition finish before reading the colours.
        await expect
          .poll(() => ownContrastRatio(eventsTab), { timeout: 5_000 })
          .toBeGreaterThanOrEqual(4.5);
        await expectNoSeriousAxeFindings(page, "[role=tablist]");
      });
    }

    test("Tourism & Events says it has nothing yet when no filter is set", async ({ page }) => {
      await answerEmptyTourismFeeds(page);
      await page.goto("/tourism-events");
      const empty = page.getByTestId("promotions-grid-empty");
      await expect(empty).toContainText("No stays or events yet");
      await expect(empty).not.toContainText("match your filters");
      await expect(empty.getByRole("button", { name: /clear all filters/i })).toHaveCount(0);
      await expect(empty.getByRole("link", { name: /list a stay or place/i })).toBeVisible();
      await expectNoSeriousAxeFindings(page);

      await page.goto("/tourism-events?province=Gauteng");
      await expect(empty).toContainText("Nothing matches your filters");
      await expect(empty.getByRole("button", { name: /clear all filters/i })).toBeVisible();
    });

    test("the desktop showroom has a pause control and is silent while it rotates", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/dev/showroom-drag");
      const slides = page.getByLabel("Carousel slides");
      const live = page.locator("[aria-live]").filter({ hasText: /^Slide \d+ of \d+$/ });
      const pause = page.getByRole("button", { name: "Pause slides" });

      await expect(pause).toBeVisible();
      await expect(live).toHaveAttribute("aria-live", "off");

      // The control comes before the slides in the tab order.
      await pause.focus();
      await page.keyboard.press("Tab");
      await expect(slides).toBeFocused();
      // Focus on the slides holds them, so the visitor's own moves are announced.
      await expect(live).toHaveAttribute("aria-live", "polite");

      await pause.focus();
      await expect(live).toHaveAttribute("aria-live", "off");
      await page.keyboard.press("Enter");
      const play = page.getByRole("button", { name: "Play slides" });
      await expect(play).toBeFocused();
      await expect(live).toHaveAttribute("aria-live", "polite");
      await page.keyboard.press("Enter");
      await expect(pause).toBeFocused();
      await expect(live).toHaveAttribute("aria-live", "off");
    });

    test("the showroom shows no pause control when it never moves by itself", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/dev/showroom-drag");
      const live = page.locator("[aria-live]").filter({ hasText: /^Slide \d+ of \d+$/ });
      await expect(live).toHaveAttribute("aria-live", "polite");
      await expect(page.getByRole("button", { name: /^(Pause|Play) slides$/ })).toHaveCount(0);
    });

    test("the error page sends a signed-out visitor to the homepage", async ({ page }) => {
      await page.goto("/error");
      const actions = page.getByRole("main").getByRole("link", { name: /^Go to / });
      await expect(actions).toHaveText(["Go to homepage"]);
      await expect(actions.first()).toHaveAttribute("href", "/");
      await expectNoSeriousAxeFindings(page);
    });
  });
}
