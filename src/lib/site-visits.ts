// Explicit public routes only. Keep in sync with public.site_visit_area in SQL.
const PUBLIC_PAGES = new Set([
  "/",
  "/mzansi-market",
  "/mzansi-business",
  "/tourism-events",
  "/promotions",
  "/promotions/events",
  "/pricing",
  "/advertise",
  "/contact",
  "/trust-safety",
  "/privacy",
  "/terms",
  "/paia",
  "/help/verification",
  "/help/showroom",
  "/sponsors",
  "/search",
  "/verify-buyer",
  "/safety",
  "/safety/scam-alerts",
  "/safety/meeting-checklist",
]);

export function isTrackablePath(path: string): boolean {
  return (
    PUBLIC_PAGES.has(path) ||
    /^\/organisation\/[a-z0-9][a-z0-9-]{0,80}$/.test(path) ||
    /^\/(listing|mzansi-business|tourism-events)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      path
    )
  );
}
