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
  "/safety",
  "/safety/scam-alerts",
  "/safety/meeting-checklist",
]);

export function isTrackablePath(path: string): boolean {
  return (
    PUBLIC_PAGES.has(path) ||
    /^\/(listing|mzansi-business|tourism-events)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      path
    )
  );
}
