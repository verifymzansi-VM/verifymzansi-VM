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
    reason: "Visual regression baselines are platform-specific — skipped in CI",
    why: "No Linux baseline pictures exist yet (check A0-08). Roadmap M0.12 builds and approves them and removes this skip.",
  },
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
    reason: "Fake camera requires Chromium",
    why: "The fake camera device flag exists only in Chromium.",
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
    reason: "The desktop dashboard check runs once, in the chromium project.",
    why: "Desktop layout check, run once to avoid duplicate work.",
  },
  {
    reason: "The mobile dashboard check runs once, in the mobile-chrome project.",
    why: "Phone layout check, run once to avoid duplicate work.",
  },
  {
    reason: "Desktop posting flows run once, in the chromium project.",
    why: "The posting forms are exercised once on desktop; each run creates posts in the shared stand-in.",
  },
  {
    reason: "Mobile posting flows run once, in the mobile-chrome project.",
    why: "The posting forms are exercised once on a phone; each run creates posts in the shared stand-in.",
  },
  {
    reason: "The profile completion flow runs once, in the chromium project.",
    why: "Account flow without a layout difference; run once.",
  },
  {
    reason: "API-level account checks run once per run, in the chromium project",
    why: "Foundation test copy: database-level checks that do not depend on the browser.",
  },
];
