import { expect, test, type Page } from "@playwright/test";

// Button hierarchy (owner-approved 20 November 2026, ledger group 66): each
// screen has one filled main button (brand green, or gold on a dark-green
// band); everything else is outlined, tinted or a text link. The phone bottom
// bar's round "+ Post" is the one exception.
//
// For each public page this measures every visible link and button whose
// background is a filled brand green or gold and checks:
// - the site header has none (Register and + Post are tinted, not filled);
// - in the page's main content, no two of them fit on one screen (the top of
//   one and the bottom of the next are less than a viewport height apart);
// - the footer has at most one (the closing band's gold "Post for free");
// - where that footer button is the page's main button (Home), the page's main
//   content has no filled button at all.
// Selected states (tabs, current page, pressed filters) and disabled buttons
// are not actions and are not counted. Red is not a main-button colour here:
// the Safety Centre's red "Call SAPS 10111" stays filled as an emergency
// exception (owner, 20 November 2026). Runs on the desktop (1280 px) and phone
// (Pixel 7) projects.

type Filled = { label: string; region: "main" | "header" | "footer"; top: number; bottom: number };

/** Filled brand colours: brand-green 500/600/700, the dark-mode primary, brand-gold 300/400/500. */
const FILLED_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [20, 154, 107],
  [11, 122, 85],
  [8, 98, 74],
  [34, 170, 125],
  [255, 194, 77],
  [249, 168, 38],
  [236, 141, 12],
];

/** `main`: the page's main button; `mainIn: "footer"` when it is the footer band's. */
const PAGES: ReadonlyArray<{ path: string; main?: RegExp; mainIn?: "main" | "footer" }> = [
  // Home: the About section's "Post for free" is outlined; the footer band's gold one is the main one.
  { path: "/", main: /^Post for free/, mainIn: "footer" },
  { path: "/pricing", main: /^Post for free$/ },
  { path: "/advertise", main: /^Post for free$/ },
  // No marketplace post is seeded, so the empty box's button is the main one.
  { path: "/mzansi-market", main: /Post a listing/ },
  { path: "/mzansi-business" },
  { path: "/tourism-events" },
  { path: "/safety", main: /^Report a problem$/ },
  { path: "/trust-safety", main: /^Report a concern$/ },
  { path: "/help/verification", main: /^Continue verification$/ },
  { path: "/help/business-verification", main: /^Verify my business$/ },
  { path: "/terms" },
  { path: "/privacy" },
  { path: "/paia" },
  { path: "/contact" },
];

async function filledButtons(page: Page): Promise<Filled[]> {
  return page.evaluate((palette) => {
    const isFilled = (color: string) => {
      const match = color.match(/rgba?\(([^)]+)\)/);
      if (!match) return false;
      const [r, g, b, a = 1] = match[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      if (a < 0.85) return false;
      return palette.some(
        ([pr, pg, pb]) => Math.abs(r - pr) <= 6 && Math.abs(g - pg) <= 6 && Math.abs(b - pb) <= 6
      );
    };
    const out: Array<{ label: string; region: string; top: number; bottom: number }> = [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>("a, button, [role='button']")
    )) {
      if (el.closest("nav[aria-label='Main']")) continue; // phone bottom bar
      if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true")
        continue;
      const role = el.getAttribute("role");
      if (role && ["tab", "radio", "option", "switch", "checkbox", "menuitem"].includes(role))
        continue;
      if (
        el.getAttribute("aria-pressed") === "true" ||
        el.getAttribute("aria-selected") === "true" ||
        el.hasAttribute("aria-current")
      )
        continue;
      if (el.closest("[hidden], [inert], [aria-hidden='true']")) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (!isFilled(style.backgroundColor)) continue;
      const region = el.closest("main")
        ? "main"
        : el.closest("footer")
          ? "footer"
          : el.closest("header")
            ? "header"
            : null;
      if (!region) continue; // transient overlays (install prompt, toasts)
      out.push({
        label: (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "),
        region,
        top: rect.top + window.scrollY,
        bottom: rect.bottom + window.scrollY,
      });
    }
    return out;
  }, FILLED_RGB) as Promise<Filled[]>;
}

test.use({ serviceWorkers: "block" });

test.describe("One main button per screen (group 66)", () => {
  for (const { path, main, mainIn = "main" } of PAGES) {
    test(`${path} has one filled main button per screen`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main").first()).toBeVisible();
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

      const filled = await filledButtons(page);
      const viewportHeight = page.viewportSize()?.height ?? 720;
      const describe = (items: Filled[]) =>
        items.map((item) => `"${item.label}" at ${Math.round(item.top)} px`).join(", ");

      const header = filled.filter((item) => item.region === "header");
      expect(header, `filled buttons in the site header: ${describe(header)}`).toEqual([]);

      const footer = filled.filter((item) => item.region === "footer");
      expect(footer.length, `filled buttons in the footer: ${describe(footer)}`).toBeLessThan(2);

      const inMain = filled.filter((item) => item.region === "main").sort((a, b) => a.top - b.top);
      for (let i = 1; i < inMain.length; i++) {
        const [upper, lower] = [inMain[i - 1], inMain[i]];
        expect(
          lower.bottom - upper.top,
          `two filled buttons fit on one ${viewportHeight} px screen: ${describe([upper, lower])}`
        ).toBeGreaterThan(viewportHeight);
      }

      // The check sees the page's main button, so it is not passing by missing colours.
      if (main) {
        const region = mainIn === "footer" ? footer : inMain;
        expect(
          region.some((item) => main.test(item.label)),
          `expected ${main} as a filled button in the ${mainIn}; found ${describe(region) || "none"}`
        ).toBe(true);
      }
      // The footer's button is the main one, so the page body has none of its own.
      if (mainIn === "footer") {
        expect(inMain, `filled buttons in the page body: ${describe(inMain)}`).toEqual([]);
      }
    });
  }
});
