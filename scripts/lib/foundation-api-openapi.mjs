import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { assertFixturePath, ensureFixtureDirectory } from "./foundation-native-paths.mjs";

export const API_ROLES = ["anon", "authenticated", "service_role"];
const hash = (value) => createHash("sha256").update(value).digest("base64url");

export function verifyRoleOpenapi(spec, manifest, role) {
  assert.ok(API_ROLES.includes(role));
  assert.equal(spec.swagger, "2.0");
  assert.equal(typeof spec.paths, "object");
  const functions = manifest.functions.filter((fn) => fn.execute[role]);
  assert.deepEqual(
    Object.keys(spec.paths)
      .filter((path) => path !== "/")
      .sort(),
    functions.map((fn) => `/rpc/${fn.name}`).sort(),
    "OpenAPI role surface differs from SQL grants"
  );
  assert.equal(
    Object.keys(spec.definitions ?? {}).length,
    0,
    "No private/base table DTOs in exposed schema"
  );
  for (const fn of functions) {
    const path = spec.paths[`/rpc/${fn.name}`];
    assert.ok(path.post, "Every RPC must advertise POST");
    assert.equal(Boolean(path.get), fn.volatility !== "v", `${fn.name} HTTP volatility`);
    const body = path.post.parameters.filter((parameter) => parameter.in === "body");
    assert.equal(body.length, 1);
    assert.equal(body[0].schema.type, "object");
    assert.deepEqual(
      Object.keys(body[0].schema.properties ?? {}).sort(),
      fn.arguments.map((arg) => arg.name).sort(),
      `${fn.name} HTTP argument names`
    );
    assert.deepEqual(
      [...(body[0].schema.required ?? [])].sort(),
      fn.arguments
        .filter((arg) => !arg.optional)
        .map((arg) => arg.name)
        .sort(),
      `${fn.name} HTTP required arguments`
    );
  }
  return functions.length;
}

export async function captureRoleOpenapi({ port, jwt, candidateHash }) {
  assert.equal(port, "55443");
  assertFixturePath(process.cwd(), "database/foundation/api-manifest.json", { type: "file" });
  const apiBytes = readFileSync("database/foundation/api-manifest.json");
  const apiManifest = JSON.parse(apiBytes);
  assert.equal(apiManifest.candidateHash, candidateHash);
  const specs = [];
  for (const role of API_ROLES) {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      headers: {
        Accept: "application/openapi+json",
        "Accept-Profile": "api",
        Authorization: `Bearer ${jwt(role)}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 200);
    const raw = await response.text();
    const spec = JSON.parse(raw);
    const count = verifyRoleOpenapi(spec, apiManifest, role);
    // Describe the intended gateway route without publishing a disposable port
    // as a deployment endpoint. SQL-generated operations remain unmodified.
    const normalised = {
      ...spec,
      host: "foundation.invalid",
      basePath: "/rest/v1",
      schemes: ["https"],
    };
    specs.push({
      role,
      rpcCount: count,
      rawLocalResponseHash: hash(raw),
      path: `database/foundation/openapi/${role}.json`,
      bytes: JSON.stringify(normalised, null, 2) + "\n",
    });
  }
  ensureFixtureDirectory(process.cwd(), "database/foundation/openapi");
  const manifestPath = "database/foundation/api-openapi-manifest.json";
  for (const target of [manifestPath, ...specs.map((spec) => spec.path)])
    assertFixturePath(process.cwd(), target, { allowMissing: true, type: "file" });
  const manifest = {
    schemaVersion: 1,
    candidateHash,
    apiManifestHash: hash(apiBytes),
    releaseReady: false,
    source:
      "Fresh local PostgREST role-sensitive OpenAPI, synthetic JWT roles; generated operations unchanged",
    normalisation:
      "Only host/basePath/schemes replaced with foundation.invalid/rest/v1/https; no target URL or credentials",
    limitation:
      "Observed SQL transport schema, not runtime Json DTO validation, body authorization or hosted gateway/GoTrue acceptance",
    specs: specs.map(({ bytes, ...spec }) => ({ ...spec, hash: hash(bytes) })),
  };
  for (const spec of specs) writeFileSync(spec.path, spec.bytes);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return {
    status: "PASS all three role OpenAPI surfaces and required arguments match SQL",
    manifestPath,
    manifestHash: hash(readFileSync(manifestPath)),
    roleCounts: Object.fromEntries(manifest.specs.map((spec) => [spec.role, spec.rpcCount])),
  };
}
