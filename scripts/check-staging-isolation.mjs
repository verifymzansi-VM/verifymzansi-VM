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
  // Required: the website approves the staging project only on a Worker
  // whose ENVIRONMENT is "staging" (src/lib/foundation/hosted-projects.ts).
  flag(vars.ENVIRONMENT !== "staging", `ENVIRONMENT must be "staging" in staging`);
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

// ── Resolved configuration (what wrangler would actually deploy) ──────────────
// Wrangler inherits some top-level keys into an environment (for example
// `routes`, `triggers`, `build`, `assets`). Reading the raw TOML misses that: a
// staging section without `routes = []` would inherit production's custom
// domains, and a CI deploy would move them to the staging Worker. So the
// staging environment is also resolved with wrangler's own reader.

// Binding kinds and the field naming the shared resource.
const RESOURCE_FIELDS = [
  ["kv_namespaces", "id"],
  ["r2_buckets", "bucket_name"],
  ["d1_databases", "database_id"],
  ["services", "service"],
  ["hyperdrive", "id"],
  ["vectorize", "index_name"],
  ["analytics_engine_datasets", "dataset"],
];

const stripAnsi = (text) => String(text).replace(/\u001b\[[0-9;]*m/g, "");

function resourceIds(config) {
  const out = new Set();
  for (const [kind, field] of RESOURCE_FIELDS)
    for (const item of Array.isArray(config?.[kind]) ? config[kind] : [])
      if (item?.[field]) out.add(`${kind}:${item[field]}`);
  for (const producer of config?.queues?.producers ?? [])
    if (producer?.queue) out.add(`queues:${producer.queue}`);
  for (const consumer of config?.queues?.consumers ?? [])
    if (consumer?.queue) out.add(`queues:${consumer.queue}`);
  return out;
}

/**
 * Checks a resolved staging environment against the resolved production
 * environment(s) of the same config. `warnings` are wrangler's own messages
 * while resolving staging; any of them fails (inheritance is reported there),
 * except the one reviewed notice below.
 * @param {{ staging: any, production: any[], warnings?: string[] }} resolved
 * @param {string} label
 * @returns {string[]}
 */
export function checkResolvedStaging({ staging, production, warnings = [] }, label) {
  const failures = [];
  const flag = (condition, message) => condition && failures.push(`${label}: ${message}`);
  for (const warning of warnings) {
    const text = stripAnsi(warning).replace(/\s+/g, " ").trim();
    // Each finding is one "- ..." item under an environment heading.
    const items = text
      .split(/ - /)
      .slice(1)
      .filter((item) => !/^"env\.[\w-]+" environment configuration$/.test(item));
    const findings = (text.includes(" - ") ? items : [text]).filter(
      // Reviewed: staging leaves out the Images binding on purpose (its free
      // allowance is shared with production); wrangler notes the omission.
      (item) => !/^"images" exists at the top level, but not on "env\.staging"/.test(item)
    );
    for (const item of findings) flag(true, `wrangler warns: ${item.slice(0, 300)}`);
  }
  const routes = [
    ...(Array.isArray(staging.routes) ? staging.routes : []),
    ...(staging.route ? [staging.route] : []),
  ];
  for (const route of routes)
    flag(
      true,
      `resolves ${typeof route === "object" && route?.custom_domain ? "custom domain" : "route"} ${
        typeof route === "string" ? route : route?.pattern
      }; staging must have none`
    );
  const crons = staging.triggers?.crons ?? [];
  flag(crons.length > 0, `resolves cron triggers ${crons.join(", ")}; staging must have none`);
  const productionNames = new Set(production.map((config) => config.name).filter(Boolean));
  flag(
    !staging.name || productionNames.has(staging.name) || !staging.name.endsWith("-staging"),
    `resolved Worker name "${staging.name}" is not staging-specific`
  );
  const productionResources = new Set(production.flatMap((config) => [...resourceIds(config)]));
  for (const id of resourceIds(staging))
    flag(productionResources.has(id), `binding ${id} is shared with production`);
  for (const binding of staging.durable_objects?.bindings ?? [])
    flag(
      Boolean(binding?.script_name) &&
        (productionNames.has(binding.script_name) || !binding.script_name.endsWith("-staging")),
      `Durable Object ${binding?.name} lives in Worker "${binding?.script_name}"`
    );
  flag(Boolean(staging.images), "resolves the Images binding (production's allowance)");
  return failures;
}

/** Reads one environment of a wrangler config the way wrangler does, collecting its warnings. */
export async function resolveWranglerEnvironment(configPath, env) {
  const { unstable_readConfig } = await import("wrangler");
  const warnings = [];
  const original = { warn: console.warn, log: console.log };
  console.warn = (...parts) => warnings.push(parts.map(String).join(" "));
  console.log = (...parts) => {
    const text = parts.map(String).join(" ");
    if (/WARNING/.test(stripAnsi(text))) warnings.push(text);
  };
  try {
    const config = unstable_readConfig({ config: configPath, env }, { hideWarnings: false });
    return { config, warnings };
  } finally {
    console.warn = original.warn;
    console.log = original.log;
  }
}

/** Resolves staging and production of one config file and checks them. */
export async function checkResolvedConfigFile(configPath, label = configPath) {
  const staging = await resolveWranglerEnvironment(configPath, "staging");
  const raw = parse(readFileSync(configPath, "utf8"));
  const production = [(await resolveWranglerEnvironment(configPath, undefined)).config];
  if (raw.env?.production)
    production.push((await resolveWranglerEnvironment(configPath, "production")).config);
  return checkResolvedStaging(
    { staging: staging.config, production, warnings: staging.warnings },
    label
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const requireStaging = args.includes("--require-staging");
  const file = args.find((arg) => !arg.startsWith("--")) ?? "wrangler.toml";
  const config = parse(readFileSync(file, "utf8"));
  const failures = checkStagingIsolation(config, { requireStaging });
  if (config.env?.staging) failures.push(...(await checkResolvedConfigFile(file)));
  // Companions are checked with the default config only; a single named file
  // is checked alone.
  if (!args.some((arg) => !arg.startsWith("--")))
    for (const companion of COMPANION_CONFIGS)
      if (existsSync(companion)) {
        const companionConfig = parse(readFileSync(companion, "utf8"));
        failures.push(
          ...checkCompanionIsolation(companionConfig, companion, { requireStaging }),
          ...(companionConfig.env?.staging ? await checkResolvedConfigFile(companion) : [])
        );
      }
  if (failures.length) {
    console.error(`Staging is NOT isolated from production (${file}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    config.env?.staging
      ? "Staging configuration (raw and as wrangler resolves it) uses no production resource, route or domain."
      : "No staging environment is configured, so none can reach production."
  );
}
