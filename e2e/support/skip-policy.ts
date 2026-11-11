/**
 * The only reasons a browser test may be skipped in CI (enforced by
 * skip-guard-reporter.ts). Each entry is a platform skip: the test cannot run
 * on that browser, device or operating system by design, or it deliberately
 * runs in one project only. A skip caused by missing data, credentials or an
 * earlier test is never listed here; such a test must get its data or fail
 * (see test-data.ts). The reason must match the test.skip() text exactly.
 */
export const DOCUMENTED_SKIPS: readonly { reason: string; why: string }[] = [
  {
    reason: "Video mode is for phones and tablets",
    why: "Video mode is a touch layout; desktop projects have no such page.",
  },
  {
    reason: "The viewer is desktop-only",
    why: "The immersive viewer exists only on desktop widths.",
  },
  {
    reason: "Runs only on mobile projects.",
    why: "Touch-target and bottom-tab-bar checks have no meaning on desktop.",
  },
  {
    reason: "Mobile-only layout check",
    why: "Checks the phone footer and tab bar, which desktop widths do not show.",
  },
  {
    reason: "Mobile-only marketplace check",
    why: "Checks the phone marketplace chrome, which desktop widths do not show.",
  },
  {
    reason: "Native touch input uses Chromium CDP",
    why: "Real touch events are sent through the Chromium DevTools protocol, available only in mobile-chrome.",
  },
  {
    reason: "Desktop drag coverage runs in Chromium only.",
    why: "Mouse-drag behaviour is desktop-only and checked once, in chromium.",
  },
  {
    reason: "This smoke runs in Chromium only.",
    why: "Runtime-error smoke of the showroom pages, checked once in chromium; other projects run the full page specs.",
  },
  {
    reason: "The fake camera device is Chromium-only",
    why: "The verification camera checks use Chromium's fake media device flags; other browsers have no fake camera to capture from.",
  },
  {
    reason: "API-level account checks run once per run, in the chromium project",
    why: "Foundation test copy: database-level checks that do not depend on the browser.",
  },
];
