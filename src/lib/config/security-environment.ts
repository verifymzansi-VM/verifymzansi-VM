// This project is the verified production data target from wrangler.toml.
const PRODUCTION_SUPABASE_HOST = "tnygdgormnofpgjknlhr.supabase.co";

/** Development servers accessing live data must retain production security controls. */
export function isProductionDataEnvironment(): boolean {
  if (process.env.NODE_ENV === "production" || process.env.ENVIRONMENT === "production")
    return true;
  try {
    return (
      new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname === PRODUCTION_SUPABASE_HOST
    );
  } catch {
    return false;
  }
}
