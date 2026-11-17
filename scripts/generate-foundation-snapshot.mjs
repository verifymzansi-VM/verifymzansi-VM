#!/usr/bin/env node
// Regenerates database/foundation/current/ (the readable current schema) from
// the embedded-Postgres replay of database/foundation. Nothing here can reach
// a hosted database.
//
//   pnpm db:foundation:snapshot            rewrite the folder (commit the result)
//   pnpm db:foundation:snapshot -- --check list differences without writing
//
// CI rewrites the folder and then fails on `git diff`/untracked files, so a
// schema change without a regenerated snapshot cannot merge.
import { replayFoundation } from "./lib/foundation-replay.mjs";
import {
  SNAPSHOT_DIR,
  pgliteJson,
  readSnapshotCatalogue,
  renderSnapshot,
  snapshotDifferences,
  writeSnapshot,
} from "./lib/foundation-snapshot.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.some((arg) => arg !== "--check")) {
  throw new Error(`Unsupported argument: ${args.join(" ")}`);
}
const check = args.includes("--check");

const { db, updates } = await replayFoundation();
let files;
try {
  files = renderSnapshot(await readSnapshotCatalogue(pgliteJson(db)));
} finally {
  await db.close();
}

if (check) {
  const differences = snapshotDifferences(files);
  if (differences.length > 0) {
    console.error(`::error::${SNAPSHOT_DIR} is out of date with the replay:`);
    for (const difference of differences.slice(0, 50)) console.error(`  - ${difference}`);
    if (differences.length > 50) console.error(`  ... and ${differences.length - 50} more`);
    console.error("Run `pnpm db:foundation:snapshot` and commit the folder.");
    process.exit(1);
  }
  console.log(`${SNAPSHOT_DIR} matches the replay (${files.size} files).`);
} else {
  writeSnapshot(files);
  console.log(
    `Wrote ${files.size} files to ${SNAPSHOT_DIR} from candidate.sql and ${updates.length} updates.`
  );
}
