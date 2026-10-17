import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyRoleOpenapi } from "./lib/foundation-api-openapi.mjs";

const fn = {
  name: "command",
  volatility: "v",
  arguments: [
    { name: "p_id", optional: false },
    { name: "p_limit", optional: true },
  ],
  execute: { anon: false, authenticated: true, service_role: false },
};
const manifest = { functions: [fn] };
const spec = () => ({
  swagger: "2.0",
  definitions: {},
  paths: {
    "/": { get: {} },
    "/rpc/command": {
      post: {
        parameters: [
          {
            in: "body",
            schema: { type: "object", properties: { p_id: {}, p_limit: {} }, required: ["p_id"] },
          },
        ],
      },
    },
  },
});

test("role-sensitive OpenAPI exactly follows RPC grants, argument names and required defaults", () => {
  assert.equal(verifyRoleOpenapi(spec(), manifest, "authenticated"), 1);
  assert.throws(() => verifyRoleOpenapi(spec(), manifest, "anon"));
  assert.throws(() => verifyRoleOpenapi(spec(), manifest, "service_role"));
  const missing = spec();
  delete missing.paths["/rpc/command"];
  assert.throws(() => verifyRoleOpenapi(missing, manifest, "authenticated"));
  const wrong = spec();
  wrong.paths["/rpc/command"].post.parameters[0].schema.required.push("p_limit");
  assert.throws(() => verifyRoleOpenapi(wrong, manifest, "authenticated"));
  const extra = spec();
  extra.paths["/private_table"] = { get: {} };
  assert.throws(() => verifyRoleOpenapi(extra, manifest, "authenticated"));
  const broad = spec();
  broad.paths["/rpc/command"].post.parameters[0].schema.properties.actor_id = {};
  assert.throws(() => verifyRoleOpenapi(broad, manifest, "authenticated"));
});

test("volatile command GET, private definitions and missing stable GET cannot pass", () => {
  const withGet = spec();
  withGet.paths["/rpc/command"].get = {};
  assert.throws(() => verifyRoleOpenapi(withGet, manifest, "authenticated"));
  const definitions = spec();
  definitions.definitions.private_user = {};
  assert.throws(() => verifyRoleOpenapi(definitions, manifest, "authenticated"));
  const stable = { functions: [{ ...fn, volatility: "s" }] };
  assert.throws(() => verifyRoleOpenapi(spec(), stable, "authenticated"));
  assert.equal(verifyRoleOpenapi(withGet, stable, "authenticated"), 1);
});

test("PostgREST documents a zero-argument POST as an empty object body", () => {
  const empty = spec();
  empty.paths["/rpc/command"].post.parameters[0].schema = { type: "object" };
  assert.equal(
    verifyRoleOpenapi(empty, { functions: [{ ...fn, arguments: [] }] }, "authenticated"),
    1
  );
  const widened = spec();
  assert.throws(() =>
    verifyRoleOpenapi(widened, { functions: [{ ...fn, arguments: [] }] }, "authenticated")
  );
});
