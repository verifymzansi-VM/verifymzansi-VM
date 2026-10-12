#!/usr/bin/env node
/**
 * Refuses a staging Worker config that points at production resources.
 * Staging must use its own Supabase project, R2 buckets, rate-limit state,
 * hostnames and Worker name, and keep production-grade security modes on.
 *
 * Run before any `wrangler deploy --env staging`. Exit code 1 lists every
 * shared resource. Secret values cannot be read here; compare secret
 * provenance separately (wrangler only exposes names).
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "smol-toml";

const supabaseRef = (url) => {
  const match = typeof url === "string" ? url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/) : null;
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
        jwtRef(s.vars?.NEXT_PUBLIC_SUPABASE_ANON_KEY),
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

/** Returns a list of isolation failures; an empty list means staging is separate. */
export function checkStagingIsolation(config) {
  const staging = config.env?.staging;
  if (!staging) return ["No [env.staging] section exists"];
  const prod = productionIdentity(config);
  const vars = staging.vars ?? {};
  const failures = [];
  const flag = (condition, message) => condition && failures.push(message);

  flag(
    !staging.name || prod.names.has(staging.name),
    `Worker name "${staging.name}" is not staging-specific`
  );
  for (const [key, ref] of [
    ["NEXT_PUBLIC_SUPABASE_URL", supabaseRef(vars.NEXT_PUBLIC_SUPABASE_URL)],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", jwtRef(vars.NEXT_PUBLIC_SUPABASE_ANON_KEY)],
  ]) {
    flag(!ref, `${key} is missing or unrecognised; staging must name its own Supabase project`);
    flag(ref && prod.supabaseRefs.has(ref), `${key} uses the production Supabase project (${ref})`);
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
    flag(vars[key] === "development", `${key}="development" relaxes production security controls`);
  flag(vars.NODE_ENV !== "production", `NODE_ENV must be "production" in staging`);
  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2] ?? "wrangler.toml";
  const failures = checkStagingIsolation(parse(readFileSync(file, "utf8")));
  if (failures.length) {
    console.error(`Staging is NOT isolated from production (${file}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log("Staging configuration uses no production resource identifiers.");
}
