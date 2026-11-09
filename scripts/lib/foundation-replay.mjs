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
 * The ordered replay: the platform prelude, candidate.sql, then every update in
 * filename order, with the baseline supplement just before the update that
 * needs it. Shared by the PGlite replay and the plpgsql_check lint database.
 */
export function replaySteps(root = process.cwd()) {
  const updates = listUpdates(root);
  if (!updates.includes(SUPPLEMENT_BEFORE)) {
    throw new Error(`Expected update ${SUPPLEMENT_BEFORE} is missing`);
  }
  const steps = [
    { label: "platform-prelude.sql", file: `${FOUNDATION_DIR}/replay/platform-prelude.sql` },
    { label: "candidate.sql", file: `${FOUNDATION_DIR}/candidate.sql` },
  ];
  for (const update of updates) {
    if (update === SUPPLEMENT_BEFORE) {
      steps.push({
        label: "baseline-supplement.sql",
        file: `${FOUNDATION_DIR}/replay/baseline-supplement.sql`,
      });
    }
    steps.push({ label: update, file: `${FOUNDATION_DIR}/updates/${update}` });
  }
  return { updates, steps: steps.map((step) => ({ ...step, sql: read(root, step.file) })) };
}

/**
 * Applies replaySteps() in an embedded Postgres, then any extra SQL. Returns
 * the open database; the caller closes it. With `through`, the replay stops
 * after that update (for example the last update production has received).
 */
export async function replayFoundation({ root = process.cwd(), extraSql = [], through } = {}) {
  const started = Date.now();
  const replay = replaySteps(root);
  let { updates, steps } = replay;
  if (through !== undefined) {
    const last = steps.findIndex((step) => step.label === through);
    if (last < 0 || !updates.includes(through)) throw new Error(`Unknown update ${through}`);
    steps = steps.slice(0, last + 1);
    updates = updates.slice(0, updates.indexOf(through) + 1);
  }
  const db = new PGlite({ extensions: { pg_trgm } });
  const apply = async (label, sql) => {
    try {
      await db.exec(sql);
    } catch (error) {
      await db.close();
      throw new Error(`Replay failed at ${label}: ${error.message}`);
    }
  };
  for (const step of steps) await apply(step.label, step.sql);
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
