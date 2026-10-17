import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { assertFixturePath } from "./lib/foundation-native-paths.mjs";
import { FIXTURE_MIGRATIONS } from "./lib/foundation-native-isolation.mjs";
import {
  assertCompleteFoundationSources,
  inspectApiTypes,
  roleTypeSource,
} from "./lib/foundation-api-contracts.mjs";
import { API_ROLES, verifyRoleOpenapi } from "./lib/foundation-api-openapi.mjs";
import { assertUnreleasedBaselineGuard } from "./lib/foundation-baseline-guard.mjs";

// Offline consistency gate. A fresh local replay separately proves actual SQL
// grant/default parity; this gate catches candidate/source/type drift in builds.
assert.equal(process.argv.length, 2);
const hash = (value) => createHash("sha256").update(value).digest("base64url");
const read = (file) => {
  assertFixturePath(process.cwd(), file, { type: "file" });
  return readFileSync(file);
};
const assembly = JSON.parse(read("database/foundation/assembly.json"));
const manifest = JSON.parse(read("database/foundation/api-manifest.json"));
assert.equal(assembly.releaseReady, false);
assert.equal(manifest.releaseReady, false);
assert.equal(manifest.schema, "api");
assert.equal(manifest.candidateHash, assembly.candidateHash);
assert.equal(hash(read("database/foundation/candidate.sql")), manifest.candidateHash);
assertCompleteFoundationSources(assembly.sourceHashes, Object.values(FIXTURE_MIGRATIONS));
for (const [file, digest] of Object.entries(assembly.sourceHashes))
  assert.equal(hash(read(file)), digest, `Foundation source drift: ${file}`);
const guard = read(`database/foundation/${assembly.cliGeneratedMigration}`).toString("utf8");
assertUnreleasedBaselineGuard(guard);
assert.equal(hash(guard), assembly.deploymentGuardHash);
const types = read("database/foundation/api.types.ts");
const roles = read("database/foundation/api-role-types.ts");
assert.equal(hash(types), manifest.generatedTypesHash);
assert.equal(hash(roles), manifest.roleTypesHash);
const count = inspectApiTypes(types.toString("utf8"), manifest.functions);
const roleSource = roleTypeSource(manifest.functions);
assert.equal(typeof roleSource, "string");
assert.ok(roleSource.includes("export type FoundationPublicDatabase"));
const expectedRoles = execFileSync(
  process.execPath,
  [
    "node_modules/prettier/bin/prettier.cjs",
    "--stdin-filepath",
    "database/foundation/api-role-types.ts",
  ],
  {
    input: roleSource,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  }
);
assert.equal(roles.toString("utf8"), expectedRoles);
const openapi = JSON.parse(read("database/foundation/api-openapi-manifest.json"));
assert.equal(openapi.candidateHash, manifest.candidateHash);
assert.equal(openapi.releaseReady, false);
assert.equal(openapi.apiManifestHash, hash(read("database/foundation/api-manifest.json")));
assert.deepEqual(
  openapi.specs.map((spec) => spec.role),
  API_ROLES
);
for (const spec of openapi.specs) {
  assert.equal(spec.path, `database/foundation/openapi/${spec.role}.json`);
  const bytes = read(spec.path);
  assert.equal(hash(bytes), spec.hash);
  const document = JSON.parse(bytes);
  assert.equal(document.host, "foundation.invalid");
  assert.equal(document.basePath, "/rest/v1");
  assert.deepEqual(document.schemes, ["https"]);
  assert.equal(verifyRoleOpenapi(document, manifest, spec.role), spec.rpcCount);
}
process.stdout.write(
  JSON.stringify({
    status: "PASS offline foundation API contract consistency",
    functions: count,
    schema: "api",
    candidateHash: manifest.candidateHash,
    scope:
      "Local artifact consistency; fresh SQL/HTTP replay and individual authority/DTO review remain required",
  }) + "\n"
);
