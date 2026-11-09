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
  // Captured read-only from production on 9 November 2026, through the update
  // below. Reviewed updates after it are listed as pending until the owner has
  // applied them and production is captured again.
  const check = recorded.productionCheck;
  assert.equal(check.matchedThroughUpdate, "20261109104020_post_expiry_rules.sql");
  assert.deepEqual(check.matchedFingerprints, {
    column_grants: "11724f805587a82326eae936e0200f0c",
    columns: "044ab7ea20a73ccadf55dcfd0c098d08",
    constraints: "d5dca09de2f828d738daf6cd4fecda25",
    event_triggers: "821f7d069c595c075754fad9309136ac",
    function_bodies: "98ea26681bf7aa779dac305b953d8e54",
    function_grants: "40a5a0cca5e07f24c91344a13ab1f133",
    function_metadata: "39dc03829b4f874efc4ded2e582f33d0",
    indexes: "5540f22bd7df996596b99adfb401c769",
    policies: "2c1b773d5ffe29f172271087b1f36e04",
    row_level_security: "944d5807e48498f73aa615b3026afa03",
    triggers: "cbed8a32da7aa1ca298aaa7eca019d1f",
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
  "the replay through the last applied update still equals the production capture",
  { timeout: 120000 },
  async () => {
    // Pending updates change the recorded fingerprint; the files production
    // already has must still rebuild exactly what was captured there.
    const check = recorded.productionCheck;
    const replay = await replayFoundation({ through: check.matchedThroughUpdate });
    try {
      assert.equal(replay.updates.at(-1), check.matchedThroughUpdate);
      const categories = await fingerprintFoundation(replay.db);
      for (const [category, fingerprint] of Object.entries(check.matchedFingerprints)) {
        assert.equal(categories[category].fingerprint, fingerprint, category);
      }
    } finally {
      await replay.db.close();
    }
  }
);

test("a replay cannot stop at an update that does not exist", async () => {
  await assert.rejects(
    replayFoundation({ through: "29991231235959_missing_update.sql" }),
    /Unknown update/
  );
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
