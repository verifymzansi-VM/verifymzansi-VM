import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const publicBusinessProjections = new Set([
  "get_public_frontend_business_seen",
  "get_public_frontend_business_cipc",
  "get_public_frontend_business_affiliations",
]);
function validateRuntimeAudience(fn) {
  assert.deepEqual(Object.keys(fn.execute).sort(), ["anon", "authenticated", "service_role"]);
  assert.equal(typeof fn.execute.authenticated, "boolean");
  assert.equal(typeof fn.execute.service_role, "boolean");
  assert.notEqual(fn.execute.authenticated, fn.execute.service_role);
  if (publicBusinessProjections.has(fn.name)) {
    assert.deepEqual(fn.execute, { anon: true, authenticated: true, service_role: false });
    assert.equal(fn.volatility, "s");
    assert.equal(fn.returns, "jsonb");
    assert.deepEqual(fn.arguments, [{ name: "p_post_ids", sqlType: "uuid[]", optional: false }]);
  } else assert.equal(fn.execute.anon, false);
}

const readRuntimeManifest = () =>
  JSON.parse(
    readFileSync(
      new URL("../../database/foundation/runtime-api-manifest.json", import.meta.url),
      "utf8"
    )
  );

export function provisionedFoundationApiManifest(baseline, runtime = readRuntimeManifest()) {
  assert.equal(runtime.schemaVersion, 1);
  assert.equal(runtime.schema, "api");
  const names = new Set(baseline.functions.map((fn) => fn.name));
  for (const fn of runtime.functions) {
    assert.match(fn.name, /^[a-z][a-z0-9_]{0,79}$/);
    assert.equal(names.has(fn.name), false, "Runtime extensions cannot replace baseline contracts");
    names.add(fn.name);
    validateRuntimeAudience(fn);
  }
  return { ...baseline, functions: [...baseline.functions, ...runtime.functions] };
}

/** Anonymous, read-only probe of every reviewed runtime RPC. Each result is
 * `present` (it answered as reviewed: an empty public projection or an
 * anonymous refusal), `missing` (PostgREST has no such function with these
 * arguments) or `unexpected`. No user credentials, session tokens, messages or
 * privileged writes are involved; only the publishable key is sent. */
export async function probeFoundationRuntimeApi(
  connection,
  fetcher = fetch,
  manifest = readRuntimeManifest()
) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.schema, "api");
  assert.ok(
    Array.isArray(manifest.functions) &&
      manifest.functions.length > 0 &&
      manifest.functions.length <= 160
  );
  assert.equal(new Set(manifest.functions.map((fn) => fn.name)).size, manifest.functions.length);
  const results = [];
  for (const fn of manifest.functions) {
    assert.match(fn.name, /^[a-z][a-z0-9_]{0,79}$/);
    validateRuntimeAudience(fn);
    const args = {};
    for (const arg of fn.arguments) {
      assert.match(arg.name, /^p_[a-z][a-z0-9_]{0,79}$/);
      if (arg.optional) continue;
      if (arg.sqlType === "integer" || arg.sqlType === "bigint") args[arg.name] = 1;
      else if (arg.sqlType === "boolean") args[arg.name] = true;
      else if (["text[]", "uuid[]"].includes(arg.sqlType)) args[arg.name] = [];
      else if (arg.sqlType === "timestamp with time zone") args[arg.name] = "2000-01-01T00:00:00Z";
      else if (arg.sqlType === "uuid") args[arg.name] = "00000000-0000-4000-8000-000000000001";
      else if (arg.sqlType === "text") args[arg.name] = "anonymous-runtime-presence-probe";
      else if (arg.sqlType === "jsonb") args[arg.name] = {};
      else throw new Error("Unsupported runtime API probe argument type");
    }
    const response = await fetcher(`${connection.url}/rest/v1/rpc/${fn.name}`, {
      method: "POST",
      headers: {
        apikey: connection.publishableKey,
        "Content-Type": "application/json",
        "Content-Profile": "api",
        "Accept-Profile": "api",
      },
      body: JSON.stringify(args),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json().catch(() => null);
    const publicProjection = publicBusinessProjections.has(fn.name);
    let state = "unexpected";
    if (publicProjection && response.status === 200 && Array.isArray(data) && data.length === 0)
      state = "present";
    else if (!publicProjection && [401, 403].includes(response.status) && data?.code === "42501")
      state = "present";
    else if (response.status === 404 && data?.code === "PGRST202") state = "missing";
    results.push({ name: fn.name, publicProjection, state });
  }
  return results;
}

/** Presence and audience check for reviewed additive RPCs. This is
 * not proof of authenticated DTOs or exact EXECUTE grants; SQL tests and live
 * authenticated checks provide those separate pieces of evidence. */
export async function verifyFoundationRuntimeApi(
  connection,
  fetcher = fetch,
  manifest = readRuntimeManifest()
) {
  const results = await probeFoundationRuntimeApi(connection, fetcher, manifest);
  const failed = results.find((result) => result.state !== "present");
  if (failed?.publicProjection) throw new Error("Reviewed public business projection probe failed");
  if (failed) throw new Error("Runtime API presence/authentication check failed");
  return results.length;
}
