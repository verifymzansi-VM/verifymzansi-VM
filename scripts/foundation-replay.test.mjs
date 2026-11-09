import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  FINGERPRINT_FILE,
  compareFingerprints,
  fingerprintFoundation,
  listUpdates,
  replayFoundation,
} from "./lib/foundation-replay.mjs";

const recorded = JSON.parse(readFileSync(FINGERPRINT_FILE, "utf8"));

test("the recorded fingerprint keeps the production-matched values", () => {
  // Captured read-only from production on 6 November 2026, through the update
  // below. Reviewed updates after it are listed as pending until the owner has
  // applied them and production is captured again.
  const check = recorded.productionCheck;
  assert.equal(check.matchedThroughUpdate, "20261105203431_restored_public_affiliation_badges.sql");
  assert.deepEqual(check.matchedFingerprints, {
    function_bodies: "32aa7e11dc2d5b128b9af374d3875992",
    columns: "ee319f214008a3278113bd15084419bb",
    constraints: "d379dceb97dc291ae49872bdfec430d2",
    indexes: "f4fe4b389e0780c5554b12e4be424938",
    triggers: "483f8b84299f04c1bb4df8ccdaed274a",
  });
  const pending = listUpdates().filter((update) => update > check.matchedThroughUpdate);
  assert.deepEqual(check.pendingApplication, pending);
  if (pending.length === 0) {
    for (const [category, fingerprint] of Object.entries(check.matchedFingerprints)) {
      assert.equal(recorded.categories[category].fingerprint, fingerprint);
    }
  }
});

test(
  "an edited function body without a new fingerprint fails the gate",
  { timeout: 120000 },
  async () => {
    const replay = await replayFoundation({
      extraSql: [
        "create or replace function internal.acceptance_signup_guard(p_event jsonb) returns jsonb language sql stable security invoker set search_path=pg_catalog as $$ select '{}'::jsonb $$;",
      ],
    });
    try {
      const categories = await fingerprintFoundation(replay.db);
      const differences = compareFingerprints(recorded, { updates: replay.updates, categories });
      assert.ok(differences.some((difference) => difference.startsWith("function_bodies:")));
      assert.ok(!differences.some((difference) => difference.startsWith("indexes:")));
    } finally {
      await replay.db.close();
    }
  }
);

test("a new update without a recorded fingerprint fails the gate", () => {
  const updates = [...listUpdates(), "29991231235959_unrecorded_change.sql"];
  const differences = compareFingerprints(recorded, { updates, categories: recorded.categories });
  assert.ok(differences.some((difference) => difference.startsWith("updates:")));
  assert.ok(differences.some((difference) => difference.startsWith("last update:")));
});
