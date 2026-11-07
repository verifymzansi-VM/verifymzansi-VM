import assert from "node:assert/strict";
import { test } from "node:test";
import { replayFoundation } from "./lib/foundation-replay.mjs";
import { pgliteJson } from "./lib/foundation-snapshot.mjs";
import {
  API_CATALOGUE_QUERY,
  compareApiManifests,
  compareRuntimeTypes,
  fitsSqlType,
  readApiSources,
} from "./lib/foundation-api-drift.mjs";

const sources = readApiSources();
const clone = (value) => JSON.parse(JSON.stringify(value));

async function replayCatalogue(extraSql = []) {
  const replay = await replayFoundation({ extraSql });
  try {
    return await pgliteJson(replay.db)(API_CATALOGUE_QUERY);
  } finally {
    await replay.db.close();
  }
}

test(
  "the manifests match the replayed api schema and a changed grant or argument is detected",
  { timeout: 180000 },
  async () => {
    const catalogue = await replayCatalogue();
    assert.equal(
      catalogue.length,
      sources.baseline.functions.length + sources.runtime.functions.length
    );
    assert.deepEqual(compareApiManifests({ ...sources, catalogue }), []);

    // A reviewed update that moves an execute grant, without
    // touching the manifest, must fail.
    const drifted = await replayCatalogue([
      "revoke execute on function api.purge_frontend_form_drafts(integer) from service_role;",
      "grant execute on function api.purge_frontend_form_drafts(integer) to authenticated;",
    ]);
    const differences = compareApiManifests({ ...sources, catalogue: drifted });
    assert.deepEqual(
      differences.map((difference) => difference.split(":")[0]),
      ["purge_frontend_form_drafts.execute"]
    );
  }
);

test("manifest-only drift is detected: missing, extra, renamed argument, return type", () => {
  const catalogue = [...sources.baseline.functions, ...sources.runtime.functions].map((fn) => ({
    name: fn.name,
    signature: fn.signature,
    argumentsWithDefaults: fn.argumentsWithDefaults,
    returns: fn.returns,
    volatility: fn.volatility,
    securityDefiner: fn.securityDefiner,
    owner: fn.owner,
    searchPath: fn.searchPath,
    arguments: fn.arguments,
    execute: fn.execute,
  }));
  assert.deepEqual(compareApiManifests({ ...sources, catalogue }), []);
  const runtime = clone(sources.runtime);
  const first = runtime.functions[0];
  first.arguments[0].name = "p_renamed";
  runtime.functions[1].returns = "text";
  const removed = runtime.functions.pop();
  const differences = compareApiManifests({
    ...sources,
    runtime,
    catalogue: [...catalogue, { ...catalogue[0], name: "unlisted_function" }],
  });
  assert.ok(differences.some((d) => d.startsWith(`${first.name}.arguments:`)));
  assert.ok(differences.some((d) => d.startsWith(`${runtime.functions[1].name}.returns:`)));
  assert.ok(differences.includes(`${removed.name}: in the replayed api schema but in no manifest`));
  assert.ok(
    differences.includes("unlisted_function: in the replayed api schema but in no manifest")
  );
});

test("runtime types follow every execute grant, argument and return type", () => {
  assert.deepEqual(compareRuntimeTypes(sources.runtime, sources.types), []);
  const fn = sources.runtime.functions.find(
    (candidate) => candidate.execute.authenticated && candidate.arguments.length >= 2
  );
  const [firstArg] = fn.arguments;

  const required = clone(sources.runtime);
  const target = required.functions.find((candidate) => candidate.name === fn.name);
  target.arguments[0].optional = !firstArg.optional;
  assert.ok(
    compareRuntimeTypes(required, sources.types).some((d) =>
      d.startsWith(`FoundationRuntimeAuthenticatedDatabase.${fn.name}.${firstArg.name}: typed`)
    )
  );

  const service = clone(sources.runtime);
  service.functions.find((candidate) => candidate.name === fn.name).execute.service_role = true;
  assert.ok(
    compareRuntimeTypes(service, sources.types).includes(
      `FoundationRuntimeServiceDatabase.${fn.name}: service_role can execute it, but it is not typed`
    )
  );

  const extra = sources.types.replace(
    'Functions: Baseline["api"]["Functions"] & {',
    'Functions: Baseline["api"]["Functions"] & {\n      not_a_runtime_function: { Args: Record<never, never>; Returns: Json };'
  );
  assert.notEqual(extra, sources.types);
  assert.ok(
    compareRuntimeTypes(sources.runtime, extra).includes(
      "FoundationRuntimeAuthenticatedDatabase.not_a_runtime_function: typed but not in runtime-api-manifest.json"
    )
  );
});

test("typed arguments may narrow the SQL type but never change it", () => {
  assert.equal(fitsSqlType("string", "string"), true);
  assert.equal(fitsSqlType("string | null", "string"), true);
  assert.equal(fitsSqlType('"new" | "read"', "string"), true);
  assert.equal(fitsSqlType("number", "string"), false);
  assert.equal(fitsSqlType("string[]", "string"), false);
  assert.equal(fitsSqlType("Json", "Json"), true);
  assert.equal(fitsSqlType('"x"', "Json"), false);
});
