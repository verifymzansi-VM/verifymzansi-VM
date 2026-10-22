/**
 * Discovery surfaces get the app-style tab bar. Detail pages, posting,
 * checkout, auth and dashboards keep the screen for their own sticky actions.
 * The install banner sits above this bar, so it uses the same rule.
 */
const NAV_EXACT_PATHS = new Set([
  "/",
  "/search",
  "/mzansi-market",
  "/mzansi-business",
  "/tourism-events",
  "/promotions",
  "/promotions/events",
  "/pricing",
  "/advertise",
  "/trust-safety",
  "/contact",
]);

export function shouldShowMobileNav(pathname: string | null): boolean {
  if (!pathname) return false;
  if (NAV_EXACT_PATHS.has(pathname)) return true;
  return pathname === "/safety" || pathname.startsWith("/safety/");
}
