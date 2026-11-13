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
  // Captured read-only from production on 12 November 2026, through the update
  // below. Reviewed updates after it are listed as pending until the owner has
  // applied them and production is captured again.
  const check = recorded.productionCheck;
  assert.equal(check.matchedThroughUpdate, "20261113162457_staff_invoice_payments.sql");
  assert.deepEqual(check.matchedFingerprints, {
    column_grants: "11724f805587a82326eae936e0200f0c",
    columns: "e5fe6e9bdc62c78cd919963f507b9095",
    constraints: "d61c1e06ad5842fba7ef94f4f870e7fc",
    event_triggers: "821f7d069c595c075754fad9309136ac",
    function_bodies: "a38b22f091a7d993cf5cc8d01c655a5a",
    function_grants: "757f891f3cf492274f8752ddd1969c13",
    function_metadata: "2ff1f6a04581f4caaa78ee520017b2b5",
    indexes: "25feb79228dd538d71b44b650c1d9061",
    policies: "2c1b773d5ffe29f172271087b1f36e04",
    row_level_security: "21b60c97063eb3fa39331921b2c59782",
    triggers: "8e30899c01c04079ae72d90fde99214d",
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
       revoke execute on function internal.invariant_probe_no_path() from public;
       -- Executable by authenticated, but no api function reaches it.
       create function internal.invariant_probe_unreached() returns int language sql
         set search_path = pg_catalog as 'select 1';
       revoke execute on function internal.invariant_probe_unreached() from public;
       grant execute on function internal.invariant_probe_unreached() to authenticated;
       -- Reached by an api wrapper, then through an invoker helper: allowed.
       create function internal.invariant_probe_inner() returns int language sql
         set search_path = pg_catalog as 'select 1';
       create function internal.invariant_probe_outer() returns int language sql
         set search_path = pg_catalog as 'select internal.invariant_probe_inner()';
       create function api.invariant_probe_wrapper() returns int language sql
         set search_path = pg_catalog as 'select internal.invariant_probe_outer()';
       revoke execute on function internal.invariant_probe_inner(), internal.invariant_probe_outer(),
         api.invariant_probe_wrapper() from public;
       grant execute on function internal.invariant_probe_inner(), internal.invariant_probe_outer()
         to authenticated;
       -- A listed exception that is no longer flagged.
       revoke execute on function internal.price_draft_actor() from authenticated;
       create function private.invariant_probe_fn() returns int language sql
         set search_path = pg_catalog as 'select 1';
       revoke execute on function private.invariant_probe_fn() from public;`,
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
    assert.deepEqual(byId["internal-execute-only-behind-api"], [
      "internal.invariant_probe_public()",
      "internal.invariant_probe_unreached()",
      "internal.price_draft_actor() (listed exception no longer needed; remove it)",
    ]);
    assert.deepEqual(byId["no-functions-in-private"], ["private.invariant_probe_fn()"]);
  } finally {
    await db.close();
  }
});
