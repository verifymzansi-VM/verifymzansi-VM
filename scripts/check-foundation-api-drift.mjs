#!/usr/bin/env node
// Checks api-manifest.json, runtime-api-manifest.json and runtime-api-types.ts
// against the `api` schema of the embedded-Postgres replay of
// database/foundation (names, arguments, optionality, return types,
// volatility and execute grants). Nothing here can reach a hosted database.
//
//   pnpm db:foundation:api-check
import { replayFoundation } from "./lib/foundation-replay.mjs";
import { pgliteJson } from "./lib/foundation-snapshot.mjs";
import {
  API_CATALOGUE_QUERY,
  compareApiManifests,
  compareRuntimeTypes,
  readApiSources,
} from "./lib/foundation-api-drift.mjs";

if (process.argv.slice(2).some((arg) => arg !== "--")) {
  throw new Error(`Unsupported argument: ${process.argv.slice(2).join(" ")}`);
}

const { db } = await replayFoundation();
let catalogue;
try {
  catalogue = await pgliteJson(db)(API_CATALOGUE_QUERY);
} finally {
  await db.close();
}
const sources = readApiSources();
const differences = [
  ...compareApiManifests({ ...sources, catalogue }),
  ...compareRuntimeTypes(sources.runtime, sources.types),
];
if (differences.length > 0) {
  console.error("::error::The API manifests or runtime types differ from the replayed api schema:");
  for (const difference of differences) console.error(`  - ${difference}`);
  console.error(
    "Update the manifest or types in the same pull request as the reviewed update that changes the function."
  );
  process.exit(1);
}
console.log(
  `API contracts match the replay: ${catalogue.length} api functions (${sources.baseline.functions.length} baseline, ${sources.runtime.functions.length} runtime), runtime types for every execute grant.`
);
