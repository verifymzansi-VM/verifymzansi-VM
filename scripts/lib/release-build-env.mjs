// The environment the production build runs with. It is built from an
// allowlist, never copied from the step: runner basics, the committed
// non-secret production Worker settings (wrangler.toml [env.production.vars],
// the only source of NEXT_PUBLIC_* values) and synthetic values for every
// private setting in the Worker fixture. A credential in the step's own
// environment therefore never reaches the build or its dependencies.

/** Runner and tool settings the build may inherit; none of them is a credential. */
export const RUNNER_BASICS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "CI",
  "GITHUB_ACTIONS",
  "GITHUB_WORKSPACE",
  "RUNNER_ENVIRONMENT",
  "RUNNER_OS",
  "RUNNER_ARCH",
  "RUNNER_TEMP",
  "PNPM_HOME",
  "NODE_OPTIONS",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
];

/** Release credentials that must never be in the build step at all. */
const RELEASE_ONLY_CREDENTIALS = [
  "CLOUDFLARE_API_TOKEN",
  "SITE_MONITOR_API_KEY",
  "DEPLOY_HEALTHCHECK_URL",
  "GITHUB_TOKEN",
  "SUPABASE_BACKUP_DB_PASSWORD",
  "BACKUP_R2_ACCESS_KEY_ID",
  "BACKUP_R2_SECRET_ACCESS_KEY",
];

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

/**
 * Builds the release build's environment, or returns the reasons it must not run.
 * @param {Record<string, string | undefined>} source the step's own environment
 * @param {Record<string, string>} publicVars productionWorkerVars(wrangler.toml)
 * @param {(publicSettings: Record<string, string>) => Record<string, string>} createFixture
 * @returns {{ problems: string[], environment?: Record<string, string> }}
 */
export function releaseBuildEnvironment(source, publicVars, createFixture) {
  const problems = [];
  const fixture = createFixture({
    NEXT_PUBLIC_SUPABASE_ANON_KEY: publicVars.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  const privateNames = privateBuildNames(fixture, publicVars);
  // Tripwire: the workflow must not hand a real credential to this step.
  const leaked = [...privateNames, ...RELEASE_ONLY_CREDENTIALS].filter(
    (name) => (source[name] ?? "") !== ""
  );
  if (leaked.length > 0)
    problems.push(`Private credentials must not reach the build step: ${leaked.join(", ")}`);
  // A public value is bundled into every browser: never a server key.
  const unsafePublic = Object.entries(publicVars)
    .filter(
      ([name, value]) =>
        (name.startsWith("NEXT_PUBLIC_") || name.includes("PUBLISHABLE")) &&
        /sb_secret_/i.test(value)
    )
    .map(([name]) => name);
  if (unsafePublic.length > 0)
    problems.push(`Public settings hold a server key: ${unsafePublic.join(", ")}`);
  // Public values in the step must match wrangler.toml, or the deploy's
  // build check would see a different artifact.
  const mismatched = Object.keys(source).filter(
    (name) => name.startsWith("NEXT_PUBLIC_") && (source[name] ?? "") !== (publicVars[name] ?? "")
  );
  if (mismatched.length > 0)
    problems.push(`Public settings differ from wrangler.toml: ${mismatched.join(", ")}`);
  if (problems.length > 0) return { problems };

  /** @type {Record<string, string>} */
  const environment = {};
  for (const name of RUNNER_BASICS)
    if (source[name] !== undefined) environment[name] = source[name];
  Object.assign(environment, publicVars);
  for (const name of privateNames) environment[name] = fixture[name];
  return { problems, environment };
}
