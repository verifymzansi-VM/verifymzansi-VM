#!/usr/bin/env node
// Replay gate: rebuilds the production (foundation) schema from the repository
// in an embedded Postgres and compares its fingerprint with
// database/foundation/fingerprint.json.
//
//   pnpm db:foundation:replay            check (CI)
//   pnpm db:foundation:replay -- --write record a new fingerprint, only in the
//                                        same pull request as the reviewed
//                                        update that changes it
import { readFileSync, writeFileSync } from "node:fs";
import {
  FINGERPRINT_FILE,
  compareFingerprints,
  fingerprintFoundation,
  replayFoundation,
} from "./lib/foundation-replay.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.some((arg) => arg !== "--write"))
  throw new Error(`Unsupported argument: ${args.join(" ")}`);
const write = args.includes("--write");

const { db, updates, milliseconds } = await replayFoundation();
let categories;
try {
  categories = await fingerprintFoundation(db);
} finally {
  await db.close();
}
console.log(`Replayed candidate.sql and ${updates.length} updates in ${milliseconds} ms.`);
for (const [name, value] of Object.entries(categories)) {
  console.log(`  ${name.padEnd(20)} ${String(value.items).padStart(5)}  ${value.fingerprint}`);
}

const recorded = JSON.parse(readFileSync(FINGERPRINT_FILE, "utf8"));
if (write) {
  const next = {
    ...recorded,
    updateCount: updates.length,
    lastUpdate: updates.at(-1),
    categories,
  };
  writeFileSync(FINGERPRINT_FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Recorded the replay fingerprint in ${FINGERPRINT_FILE}.`);
  process.exit(0);
}
const differences = compareFingerprints(recorded, { updates, categories });
if (differences.length > 0) {
  console.error(`::error::The replayed schema differs from ${FINGERPRINT_FILE}:`);
  for (const difference of differences) console.error(`  - ${difference}`);
  console.error(
    "If a reviewed update intentionally changes the schema, run `pnpm db:foundation:replay -- --write` and commit the new fingerprint with it."
  );
  process.exit(1);
}
console.log(`Replay matches ${FINGERPRINT_FILE}.`);
