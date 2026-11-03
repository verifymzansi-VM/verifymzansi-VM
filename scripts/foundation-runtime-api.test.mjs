import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyFoundationRuntimeApi } from "./lib/foundation-runtime-api.mjs";
const connection = {
  url: "https://gntzjtuncsyefujajmjy.supabase.co",
  publishableKey: "sb_publishable_synthetic",
};
const manifest = {
  schemaVersion: 1,
  schema: "api",
  functions: [
    {
      name: "get_my_dashboard",
      arguments: [],
      execute: { anon: false, authenticated: true, service_role: false },
    },
    {
      name: "save_my_frontend_profile",
      arguments: [{ name: "p_expected_revision", sqlType: "integer", optional: false }],
      execute: { anon: false, authenticated: true, service_role: false },
    },
  ],
};
test("probes the two authenticated extensions anonymously without a user identity or session", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ code: "42501" }, { status: 401 });
  };
  assert.equal(await verifyFoundationRuntimeApi(connection, fetcher, manifest), 2);
  assert.deepEqual(
    calls.map((c) => JSON.parse(c.init.body)),
    [{}, { p_expected_revision: 1 }]
  );
  for (const { init } of calls) {
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.headers["Content-Profile"], "api");
  }
});
test("refuses missing, accidentally public, unavailable or malformed endpoints", async () => {
  for (const [status, body] of [
    [404, { code: "PGRST202" }],
    [200, { version: 1 }],
    [503, { error: "unavailable" }],
    [401, { code: "another" }],
  ]) {
    await assert.rejects(
      verifyFoundationRuntimeApi(connection, async () => Response.json(body, { status }), manifest),
      /presence\/authentication/
    );
  }
});
test("an extension cannot silently widen the approved audience", async () => {
  const widened = {
    ...manifest,
    functions: [
      {
        ...manifest.functions[0],
        execute: { anon: true, authenticated: true, service_role: false },
      },
    ],
  };
  let requested = false;
  await assert.rejects(
    verifyFoundationRuntimeApi(
      connection,
      async () => {
        requested = true;
        return Response.json({});
      },
      widened
    )
  );
  assert.equal(requested, false);
});
