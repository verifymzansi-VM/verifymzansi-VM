// Which settings the production build may receive for real. Public values are
// the NEXT_PUBLIC_* settings and the non-secret Worker settings committed in
// wrangler.toml ([env.production.vars]). Every other name in the synthetic
// Worker fixture is a private credential and must be synthetic during the
// build.

/** The committed, non-secret production Worker settings (wrangler.toml). */
export function productionWorkerVars(config) {
  const vars = config?.env?.production?.vars;
  if (!vars || typeof vars !== "object") throw new Error("Missing production Worker settings");
  return Object.fromEntries(Object.entries(vars).filter(([, value]) => typeof value === "string"));
}

/** Private credential names in the fixture; public settings are never replaced. */
export function privateBuildNames(fixture, publicVars) {
  const publicNames = new Set(Object.keys(publicVars));
  return Object.keys(fixture).filter(
    (name) => !name.startsWith("NEXT_PUBLIC_") && !publicNames.has(name)
  );
}

/** Release credentials that are not Worker settings and must never reach the build. */
export const RELEASE_ONLY_CREDENTIALS = [
  "CLOUDFLARE_API_TOKEN",
  "SITE_MONITOR_API_KEY",
  "DEPLOY_HEALTHCHECK_URL",
  "GITHUB_TOKEN",
  "SUPABASE_BACKUP_DB_PASSWORD",
  "BACKUP_R2_ACCESS_KEY_ID",
  "BACKUP_R2_SECRET_ACCESS_KEY",
];
