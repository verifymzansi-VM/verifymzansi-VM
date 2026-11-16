/**
 * Refuses a staging Worker config that points at production resources.
 * Staging must use its own Supabase project, R2 buckets, rate-limit state,
 * companion Workers, hostnames and Worker name, and keep production-grade
 * security modes on.
 *
 * Run before any `wrangler deploy --env staging` (CI runs it on every change
 * with --require-staging). It checks wrangler.toml and, when present, the
 * staging environments of the offload and rate-limiter Worker configs. Exit
 * code 1 lists every shared resource. Secret values cannot be read here;
 * compare secret provenance separately (wrangler only exposes names).
 *
 * Run it with `node` (pnpm cloudflare:staging:isolation). It has no `#!` line
 * on purpose: its unit test imports it through Vitest, which cannot load a
 * `#!` line ending in CRLF, as Git writes it on Windows checkouts.
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "smol-toml";

/** Companion Worker configs whose staging environments are checked too. */
export const COMPANION_CONFIGS = ["wrangler.offload.toml", "wrangler.rate-limiter.toml"];

const supabaseRef = (url) => {
  const match =
    typeof url === "string" ? url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/) : null;
  return match ? match[1] : null;
};

const jwtRef = (token) => {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString());
    return typeof payload.ref === "string" ? payload.ref : null;
  } catch {
    return null;
  }
};

const isPublishableKey = (key) =>
  typeof key === "string" && /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key);

const host = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

const ids = (list, key) =>
  Array.isArray(list) ? list.map((item) => item?.[key]).filter(Boolean) : [];

const routePatterns = (routes) =>
  Array.isArray(routes)
    ? routes.map((r) => (typeof r === "string" ? r : r?.pattern)).filter(Boolean)
    : [];

/** Collects every production identifier from the top level and env.production. */
function productionIdentity(config) {
  const sections = [config, config.env?.production ?? {}];
  const set = (values) => new Set(values.filter(Boolean));
  return {
    names: set(sections.map((s) => s.name)),
    supabaseRefs: set(
      sections.flatMap((s) => [
        supabaseRef(s.vars?.NEXT_PUBLIC_SUPABASE_URL),
        supabaseRef(s.vars?.FOUNDATION_SUPABASE_URL),
        s.vars?.FOUNDATION_PROJECT_REF,
        jwtRef(s.vars?.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      ])
    ),
    publishableKeys: set(
      sections.flatMap((s) => [
        s.vars?.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        s.vars?.FOUNDATION_SUPABASE_PUBLISHABLE_KEY,
      ])
    ),
    buckets: set(
      sections.flatMap((s) => [
        s.vars?.R2_PUBLIC_BUCKET,
        s.vars?.R2_PRIVATE_BUCKET,
        ...ids(s.r2_buckets, "bucket_name"),
      ])
    ),
    kvIds: set(sections.flatMap((s) => ids(s.kv_namespaces, "id"))),
    d1Ids: set(sections.flatMap((s) => ids(s.d1_databases, "database_id"))),
    services: set(sections.flatMap((s) => ids(s.services, "service"))),
    hosts: set(
      sections.flatMap((s) => [
        host(s.vars?.NEXT_PUBLIC_APP_URL),
        host(s.vars?.NEXT_PUBLIC_MEDIA_URL),
        host(s.vars?.R2_PUBLIC_URL),
        host(s.vars?.OTP_RATE_LIMITER_URL),
        ...routePatterns(s.routes).map((p) => p.split("/")[0]),
      ])
    ),
  };
}

// Settings that switch on test shortcuts; none may appear in staging.
const BYPASS_SETTING =
  /^(NEXT_PUBLIC_)?PLAYWRIGHT_|BYPASS|^ENABLE_MOCK_|^TEST_PHONE_NUMBERS$|^DEV_EXPOSE_OTP$|^SMS_MOCK$/;

/** Staging-specific Worker name: never a production name, always "-staging". */
function checkName(staging, prod, flag) {
  flag(
    !staging.name || prod.names.has(staging.name) || !staging.name.endsWith("-staging"),
    `Worker name "${staging.name}" is not staging-specific`
  );
}

/**
 * Returns a list of isolation failures; an empty list means staging is separate.
 * Without a staging section there is nothing that can reach production, which
 * passes unless `requireStaging` is set (once a separate staging copy exists).
 */
export function checkStagingIsolation(config, { requireStaging = false } = {}) {
  const staging = config.env?.staging;
  if (!staging) return requireStaging ? ["No [env.staging] section exists"] : [];
  const prod = productionIdentity(config);
  const vars = staging.vars ?? {};
  const failures = [];
  const flag = (condition, message) => condition && failures.push(message);

  checkName(staging, prod, flag);
  const publicRef = supabaseRef(vars.NEXT_PUBLIC_SUPABASE_URL);
  flag(
    !publicRef,
    "NEXT_PUBLIC_SUPABASE_URL is missing or unrecognised; staging must name its own Supabase project"
  );
  flag(
    publicRef && prod.supabaseRefs.has(publicRef),
    `NEXT_PUBLIC_SUPABASE_URL uses the production Supabase project (${publicRef})`
  );
  const anonKey = vars.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const anonRef = jwtRef(anonKey);
  flag(
    !anonRef && !isPublishableKey(anonKey),
    "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing or unrecognised; staging must name its own Supabase project"
  );
  flag(
    (anonRef && prod.supabaseRefs.has(anonRef)) || prod.publishableKeys.has(anonKey),
    `NEXT_PUBLIC_SUPABASE_ANON_KEY uses the production Supabase project`
  );
  // The server's foundation bindings, when present, must name the same
  // staging project as the browser bundle.
  const foundationKeys = [
    "FOUNDATION_SUPABASE_URL",
    "FOUNDATION_PROJECT_REF",
    "FOUNDATION_SUPABASE_PUBLISHABLE_KEY",
  ];
  if (foundationKeys.some((key) => key in vars)) {
    const serverRef = supabaseRef(vars.FOUNDATION_SUPABASE_URL);
    flag(
      !serverRef || serverRef !== publicRef || vars.FOUNDATION_PROJECT_REF !== publicRef,
      "FOUNDATION_SUPABASE_URL and FOUNDATION_PROJECT_REF must name the staging project of NEXT_PUBLIC_SUPABASE_URL"
    );
    flag(
      vars.FOUNDATION_SUPABASE_PUBLISHABLE_KEY !== anonKey,
      "FOUNDATION_SUPABASE_PUBLISHABLE_KEY must equal NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  for (const key of ["R2_PUBLIC_BUCKET", "R2_PRIVATE_BUCKET"]) {
    flag(!vars[key], `${key} is missing`);
    flag(vars[key] && prod.buckets.has(vars[key]), `${key} uses production bucket "${vars[key]}"`);
  }
  for (const bucket of ids(staging.r2_buckets, "bucket_name"))
    flag(prod.buckets.has(bucket), `R2 binding uses production bucket "${bucket}"`);
  for (const id of ids(staging.kv_namespaces, "id"))
    flag(prod.kvIds.has(id), `KV namespace ${id} is shared with production`);
  for (const id of ids(staging.d1_databases, "database_id"))
    flag(prod.d1Ids.has(id), `D1 database ${id} is shared with production`);
  for (const service of ids(staging.services, "service"))
    flag(
      prod.services.has(service) || prod.names.has(service) || !service.endsWith("-staging"),
      `Service binding "${service}" is not a staging Worker`
    );
  // Images has no per-environment instance: the binding would spend
  // production's monthly allowance.
  flag(
    Boolean(staging.images),
    "The Images binding shares production's Cloudflare Images allowance"
  );
  for (const key of [
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_MEDIA_URL",
    "R2_PUBLIC_URL",
    "OTP_RATE_LIMITER_URL",
  ]) {
    const value = host(vars[key]);
    flag(value && prod.hosts.has(value), `${key} points at production host ${value}`);
  }
  for (const pattern of routePatterns(staging.routes))
    flag(prod.hosts.has(pattern.split("/")[0]), `Route ${pattern} is a production route`);
  // Staging must exercise the same security controls production does.
  for (const key of ["VERIFYMZANSI_RUNTIME_MODE", "VERIFYMZANSI_VALIDATION_MODE"])
    flag(
      vars[key] !== undefined && vars[key] !== "production",
      `${key}="${vars[key]}" relaxes production security controls`
    );
  for (const key of Object.keys(vars))
    flag(BYPASS_SETTING.test(key), `${key} switches on a test shortcut`);
  flag(vars.NODE_ENV !== "production", `NODE_ENV must be "production" in staging`);
  flag(
    "ENVIRONMENT" in vars && vars.ENVIRONMENT !== "staging",
    `ENVIRONMENT must be "staging" in staging`
  );
  return failures;
}

/** A companion Worker (offload, rate limiter): own name and own KV state. */
export function checkCompanionIsolation(config, label, { requireStaging = false } = {}) {
  const staging = config.env?.staging;
  if (!staging) return requireStaging ? [`${label}: no [env.staging] section exists`] : [];
  const prod = productionIdentity(config);
  const failures = [];
  const flag = (condition, message) => condition && failures.push(`${label}: ${message}`);
  checkName(staging, prod, flag);
  for (const id of ids(staging.kv_namespaces, "id"))
    flag(prod.kvIds.has(id), `KV namespace ${id} is shared with production`);
  for (const pattern of routePatterns(staging.routes))
    flag(prod.hosts.has(pattern.split("/")[0]), `Route ${pattern} is a production route`);
  // Bindings are not inherited: a staging section without its own KV binding
  // while production has one would run without rate-limit state.
  flag(
    prod.kvIds.size > 0 && ids(staging.kv_namespaces, "id").length === 0,
    "staging has no KV namespace of its own"
  );
  flag(staging.vars?.ENVIRONMENT !== "staging", `ENVIRONMENT must be "staging" in staging`);
  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const requireStaging = args.includes("--require-staging");
  const file = args.find((arg) => !arg.startsWith("--")) ?? "wrangler.toml";
  const config = parse(readFileSync(file, "utf8"));
  const failures = checkStagingIsolation(config, { requireStaging });
  // Companions are checked with the default config only; a single named file
  // is checked alone.
  if (!args.some((arg) => !arg.startsWith("--")))
    for (const companion of COMPANION_CONFIGS)
      if (existsSync(companion))
        failures.push(
          ...checkCompanionIsolation(parse(readFileSync(companion, "utf8")), companion, {
            requireStaging,
          })
        );
  if (failures.length) {
    console.error(`Staging is NOT isolated from production (${file}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    config.env?.staging
      ? "Staging configuration uses no production resource identifiers."
      : "No staging environment is configured, so none can reach production."
  );
}
