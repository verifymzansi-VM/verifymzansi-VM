import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  FINGERPRINT_FILE,
  compareFingerprints,
  fingerprintFoundation,
  listUpdates,
  policyInvariantProblems,
  POLICY_INVARIANTS,
  replayFoundation,
} from "./lib/foundation-replay.mjs";

const recorded = JSON.parse(readFileSync(FINGERPRINT_FILE, "utf8"));

test("the recorded fingerprint keeps the production-matched values", () => {
  // Captured read-only from production on 10 November 2026, through the update
  // below. Reviewed updates after it are listed as pending until the owner has
  // applied them and production is captured again.
  const check = recorded.productionCheck;
  assert.equal(check.matchedThroughUpdate, "20261110045944_intro_trial_at_first_approval.sql");
  assert.deepEqual(check.matchedFingerprints, {
    column_grants: "11724f805587a82326eae936e0200f0c",
    columns: "861ce3f25b51fe598e752c8bfa02ebf9",
    constraints: "dcd860d5723cc9ae7274c662197afdde",
    event_triggers: "821f7d069c595c075754fad9309136ac",
    function_bodies: "05039c717539671064fff1cc0537bd65",
    function_grants: "2921c0cef5199794e5aa882ee3962815",
    function_metadata: "609bde76ed7c75639aa2115bc8744e0e",
    indexes: "a5872c41378633c9426bd952ae111245",
    policies: "2c1b773d5ffe29f172271087b1f36e04",
    row_level_security: "e908b6555891cd91ae353da5b7183c56",
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

test("each access-policy invariant fails when the replayed schema breaks it", async () => {
  const { db } = await replayFoundation({
    extraSql: [
      // The schema guards against both of the first two (event trigger
      // require_table_rls, default privileges), so switch the guards off here.
      `alter event trigger require_table_rls disable;
       create table private.invariant_probe_no_rls (id int);
       alter table private.invariant_probe_no_rls disable row level security;
       create function api.invariant_probe_definer() returns int language sql
         security definer set search_path = pg_catalog as 'select 1';
       revoke execute on function api.invariant_probe_definer() from public;
       create function internal.invariant_probe_public() returns int language sql
         set search_path = pg_catalog as 'select 1';
       grant execute on function internal.invariant_probe_public() to public;
       create function internal.invariant_probe_no_path() returns int language sql as 'select 1';
       revoke execute on function internal.invariant_probe_no_path() from public;`,
    ],
  });
  try {
    const problems = await policyInvariantProblems(db);
    const byId = Object.fromEntries(problems.map((problem) => [problem.id, problem.items]));
    assert.deepEqual(Object.keys(byId).sort(), POLICY_INVARIANTS.map((item) => item.id).sort());
    assert.deepEqual(byId["rls-on-every-table"], ["private.invariant_probe_no_rls"]);
    assert.deepEqual(byId["no-security-definer-in-api"], ["api.invariant_probe_definer()"]);
    assert.deepEqual(byId["no-public-execute"], ["internal.invariant_probe_public()"]);
    assert.deepEqual(byId["fixed-search-path"], ["internal.invariant_probe_no_path()"]);
  } finally {
    await db.close();
  }
});
