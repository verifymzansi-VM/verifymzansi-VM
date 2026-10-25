import { parseFoundationConnection } from "./connection";

/** Validate one approved browser/server connection without revealing credentials. */
export function verifyFoundationDeploymentConnection(
  env: Readonly<Record<string, string | undefined>>
) {
  if (env.NEXT_PUBLIC_DATA_BACKEND !== "foundation")
    throw new Error("Foundation backend selection is required");
  const connection = parseFoundationConnection({
    url: env.FOUNDATION_SUPABASE_URL,
    expectedProjectRef: env.FOUNDATION_PROJECT_REF,
    publishableKey: env.FOUNDATION_SUPABASE_PUBLISHABLE_KEY,
  });
  if (
    connection.expectedProjectRef !== "gntzjtuncsyefujajmjy" ||
    env.NEXT_PUBLIC_SUPABASE_URL !== connection.url ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== connection.publishableKey
  )
    throw new Error("Public and server settings must identify the approved London project");
  if (
    !/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(env.FOUNDATION_SUPABASE_SECRET_KEY ?? "") ||
    env.SUPABASE_SERVICE_ROLE_KEY !== env.FOUNDATION_SUPABASE_SECRET_KEY
  )
    throw new Error("The foundation server credential and compatibility alias must match");
  return connection;
}
