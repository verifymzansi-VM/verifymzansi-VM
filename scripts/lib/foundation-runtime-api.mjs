import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Presence and anonymous-refusal probe for reviewed additive RPCs. This is
 * not proof of authenticated DTOs or exact EXECUTE grants; SQL tests and live
 * authenticated checks provide those separate pieces of evidence. No user
 * credentials, session tokens, messages or privileged writes are involved. */
export async function verifyFoundationRuntimeApi(
  connection,
  fetcher = fetch,
  manifest = JSON.parse(
    readFileSync(
      new URL("../../database/foundation/runtime-api-manifest.json", import.meta.url),
      "utf8"
    )
  )
) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.schema, "api");
  assert.ok(
    Array.isArray(manifest.functions) &&
      manifest.functions.length > 0 &&
      manifest.functions.length <= 100
  );
  assert.equal(new Set(manifest.functions.map((fn) => fn.name)).size, manifest.functions.length);
  let verified = 0;
  for (const fn of manifest.functions) {
    assert.match(fn.name, /^[a-z][a-z0-9_]{0,79}$/);
    assert.deepEqual(fn.execute, { anon: false, authenticated: true, service_role: false });
    const args = {};
    for (const arg of fn.arguments) {
      assert.match(arg.name, /^p_[a-z][a-z0-9_]{0,79}$/);
      if (arg.optional) continue;
      if (arg.sqlType === "integer") args[arg.name] = 1;
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
    if (![401, 403].includes(response.status) || data?.code !== "42501")
      throw new Error("Runtime API presence/authentication check failed");
    verified++;
  }
  return verified;
}
