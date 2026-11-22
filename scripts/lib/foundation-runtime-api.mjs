import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const isEmptyArray = (data) => Array.isArray(data) && data.length === 0;
// Reviewed public reads keyed by post ids (totals and stickers of publicly
// listed posts; no account data), each with the exact answer it gives the
// probe's empty id list.
const publicBusinessProjections = new Map([
  ["get_public_frontend_business_seen", isEmptyArray],
  ["get_public_frontend_business_cipc", isEmptyArray],
  ["get_public_frontend_business_affiliations", isEmptyArray],
  // 20261119172135_post_views_and_likes.sql: view and like totals only, as
  // {"items": [{"post_id", "views", "likes"}]} for publicly live posts, so the
  // empty id list answers exactly {"items": []}.
  [
    "get_post_engagement",
    (data) =>
      data !== null &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Object.keys(data).join() === "items" &&
      isEmptyArray(data.items),
  ],
]);
// Reviewed public reads of one post (20261121131915_business_storefront.sql:
// the storefront of a public business or listing, card facts only). The
// probe's unknown post id answers exactly null.
const publicPostReads = new Map([["get_public_storefront", (data) => data === null]]);
// Reviewed public feeds (20261121224857_fair_showroom.sql): the showroom order
// of publicly live posts, card facts only. Volatile for its random variety; it
// writes nothing. The probe's empty request is the home showroom: at most 15
// cards, each with is_new.
const publicFeedReads = new Map([
  [
    "showroom_feed",
    (data) =>
      data !== null &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Object.keys(data).join() === "items" &&
      Array.isArray(data.items) &&
      data.items.length <= 15 &&
      data.items.every((card) => typeof card?.is_new === "boolean"),
  ],
]);
// Reviewed public settings (20261117082020_online_payment_limit.sql): no
// arguments, no account data, readable by visitors like the price catalogue.
const publicSettingReads = new Map([
  [
    "get_payment_limits",
    (data) =>
      data !== null &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Object.keys(data).join() === "online_max_cents" &&
      Number.isSafeInteger(data.online_max_cents) &&
      data.online_max_cents > 0,
  ],
  // 20261120040242_signup_mode_member_invitations.sql: the sign-up mode only.
  [
    "get_signup_mode",
    (data) =>
      data !== null &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Object.keys(data).join() === "mode" &&
      ["invite_only", "open"].includes(data.mode),
  ],
  // 20261121090305_staff_sales_and_vat.sql: the VAT setting only (the number
  // only when registered).
  [
    "get_vat_registration",
    (data) =>
      data !== null &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Object.keys(data).sort().join() === "status,vat_number" &&
      ["not_registered", "registered", "undecided"].includes(data.status) &&
      (data.vat_number === null ||
        (data.status === "registered" && typeof data.vat_number === "string")),
  ],
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
  } else if (publicPostReads.has(fn.name)) {
    assert.deepEqual(fn.execute, { anon: true, authenticated: true, service_role: false });
    assert.equal(fn.volatility, "s");
    assert.equal(fn.returns, "jsonb");
    assert.deepEqual(fn.arguments, [{ name: "p_post_id", sqlType: "uuid", optional: false }]);
  } else if (publicFeedReads.has(fn.name)) {
    assert.deepEqual(fn.execute, { anon: true, authenticated: true, service_role: false });
    assert.equal(fn.volatility, "v");
    assert.equal(fn.returns, "jsonb");
    assert.deepEqual(fn.arguments, [{ name: "p_request", sqlType: "jsonb", optional: false }]);
  } else if (publicSettingReads.has(fn.name)) {
    assert.deepEqual(fn.execute, { anon: true, authenticated: true, service_role: false });
    assert.equal(fn.volatility, "s");
    assert.equal(fn.returns, "jsonb");
    assert.deepEqual(fn.arguments, []);
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
  // A sanity bound on the probe (one anonymous request per command), raised
  // from 160 when the customer invoice commands took the manifest to 163.
  assert.ok(
    Array.isArray(manifest.functions) &&
      manifest.functions.length > 0 &&
      manifest.functions.length <= 250
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
    const publicSetting =
      publicSettingReads.get(fn.name) ??
      publicPostReads.get(fn.name) ??
      publicFeedReads.get(fn.name);
    const emptyProjection = publicBusinessProjections.get(fn.name);
    const publicProjection = emptyProjection !== undefined || publicSetting !== undefined;
    let state = "unexpected";
    if (publicSetting) {
      if (response.status === 200 && publicSetting(data)) state = "present";
    } else if (emptyProjection && response.status === 200 && emptyProjection(data))
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
