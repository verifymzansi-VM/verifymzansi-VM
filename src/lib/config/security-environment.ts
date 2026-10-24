// Hosted foundation data must never receive local development bypasses. Keep
// the retired source hostname guarded too if stale local settings reference it.
const PRODUCTION_SUPABASE_HOSTS = new Set([
  "gntzjtuncsyefujajmjy.supabase.co",
  "tnygdgormnofpgjknlhr.supabase.co",
]);

/** Development servers accessing live data must retain production security controls. */
export function isProductionDataEnvironment(): boolean {
  if (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")
    return true;
  try {
    return PRODUCTION_SUPABASE_HOSTS.has(
      new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname
    );
  } catch {
    return false;
  }
}
