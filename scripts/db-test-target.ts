type TestEnvironment = Record<string, string | undefined>;

export function resolveDbTestTarget(env: TestEnvironment) {
  const url = env.DB_TEST_SUPABASE_URL;
  const anonKey = env.DB_TEST_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.DB_TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "DB tests require dedicated DB_TEST_SUPABASE_URL, DB_TEST_SUPABASE_ANON_KEY and DB_TEST_SUPABASE_SERVICE_ROLE_KEY. Application credentials are never used."
    );
  }
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
    throw new Error("DB_TEST_SUPABASE_URL must be an http(s) URL without embedded credentials.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if (!local) {
    if (env.DB_TEST_ALLOW_REMOTE !== "true") {
      throw new Error(
        "Remote DB tests require DB_TEST_ALLOW_REMOTE=true and a dedicated nonproduction project."
      );
    }
    if (
      env.NEXT_PUBLIC_SUPABASE_URL &&
      new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin === target.origin
    ) {
      throw new Error("Refusing DB tests against the configured application database.");
    }
  }
  return { url, anonKey, serviceRoleKey };
}
