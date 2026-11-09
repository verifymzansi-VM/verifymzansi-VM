// Rebuilds the foundation (production) schema from the repository alone, in an
// embedded Postgres (PGlite), and fingerprints the result. Nothing here can
// reach a hosted database.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

export const FOUNDATION_DIR = "database/foundation";
export const FINGERPRINT_FILE = `${FOUNDATION_DIR}/fingerprint.json`;
/** The supplement must exist before this update, which replaces it. */
export const SUPPLEMENT_BEFORE = "20261103154538_owner_signup_access.sql";

const read = (root, relative) => readFileSync(path.join(root, relative), "utf8");

export function listUpdates(root = process.cwd()) {
  return readdirSync(path.join(root, FOUNDATION_DIR, "updates"))
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
}

/**
 * Applies, in order: the platform prelude, candidate.sql, every update in
 * filename order (with the baseline supplement just before the update that
 * needs it). Returns the open database; the caller closes it.
 */
export async function replayFoundation({ root = process.cwd(), extraSql = [] } = {}) {
  const started = Date.now();
  const db = new PGlite({ extensions: { pg_trgm } });
  const apply = async (label, sql) => {
    try {
      await db.exec(sql);
    } catch (error) {
      await db.close();
      throw new Error(`Replay failed at ${label}: ${error.message}`);
    }
  };
  await apply("platform-prelude.sql", read(root, `${FOUNDATION_DIR}/replay/platform-prelude.sql`));
  await apply("candidate.sql", read(root, `${FOUNDATION_DIR}/candidate.sql`));
  const updates = listUpdates(root);
  if (!updates.includes(SUPPLEMENT_BEFORE)) {
    await db.close();
    throw new Error(`Expected update ${SUPPLEMENT_BEFORE} is missing`);
  }
  for (const update of updates) {
    if (update === SUPPLEMENT_BEFORE) {
      await apply(
        "baseline-supplement.sql",
        read(root, `${FOUNDATION_DIR}/replay/baseline-supplement.sql`)
      );
    }
    await apply(update, read(root, `${FOUNDATION_DIR}/updates/${update}`));
  }
  for (const [index, sql] of extraSql.entries()) await apply(`extra SQL ${index + 1}`, sql);
  return { db, updates, milliseconds: Date.now() - started };
}

/** Runs fingerprint.sql and returns { category: { items, fingerprint } }. */
export async function fingerprintFoundation(db, root = process.cwd()) {
  const result = await db.query(read(root, `${FOUNDATION_DIR}/fingerprint.sql`));
  return Object.fromEntries(
    result.rows.map((row) => [row.category, { items: row.items, fingerprint: row.fingerprint }])
  );
}

/** Lists every difference between the recorded and the replayed fingerprint. */
export function compareFingerprints(recorded, replay) {
  const differences = [];
  if (recorded.updateCount !== replay.updates.length) {
    differences.push(
      `updates: recorded ${recorded.updateCount}, repository has ${replay.updates.length}`
    );
  }
  const last = replay.updates.at(-1);
  if (recorded.lastUpdate !== last) {
    differences.push(`last update: recorded ${recorded.lastUpdate}, repository has ${last}`);
  }
  const names = new Set([
    ...Object.keys(recorded.categories ?? {}),
    ...Object.keys(replay.categories),
  ]);
  for (const name of [...names].sort()) {
    const want = recorded.categories?.[name];
    const have = replay.categories[name];
    if (!want) differences.push(`${name}: not recorded`);
    else if (!have) differences.push(`${name}: missing from the replay`);
    else if (want.items !== have.items || want.fingerprint !== have.fingerprint) {
      differences.push(
        `${name}: recorded ${want.items} items ${want.fingerprint}, replay ${have.items} items ${have.fingerprint}`
      );
    }
  }
  return differences;
}
