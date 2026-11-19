#!/usr/bin/env node
// Behaviour checks for 20261118033538_remove_sample_post_hide_list.sql, the
// contract step of 20261117144001_sample_post_hide_list.sql: the sample post
// hide-list table, its two API commands and the internal functions behind them
// are removed.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. The script runs the update's read-only preflight, checks that a partial
// state and a premature rollback are refused, applies the update, proves apply
// -> rollback -> apply returns the same fingerprints, and checks that
// afterwards nobody can call the commands. Any later updates are applied at the
// end.
//
//   node --import tsx scripts/test-foundation-remove-sample-post-hide-list.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertReadOnlyPreflight,
  openUpdateCheck,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261118033538_remove_sample_post_hide_list.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const FUNCTIONS = [
  "internal.set_sample_post_hidden(text,boolean)",
  "api.set_sample_post_hidden(text,boolean)",
  "internal.get_hidden_sample_posts()",
  "api.get_hidden_sample_posts()",
];
const TABLE = "private.hidden_sample_posts";

const {
  started,
  database,
  check,
  current,
  passed: checks,
  q,
  fails,
  member,
  fingerprint,
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  // Every update before this one, as production has them.
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const present = () => [
    q(`select to_regclass('${TABLE}') is not null;`) === "t",
    ...FUNCTIONS.map((sig) => q(`select to_regprocedure('${sig}') is not null;`) === "t"),
  ];

  await check("before the update: preflight reads 'not applied' and is read only", () => {
    q(`insert into ${TABLE}(slug) values ('removed-sample');`);
    assert.deepEqual(preflight(), [
      ["summary", "remove sample post hide list: update not applied; hidden samples: 1"],
    ]);
    assertReadOnlyPreflight(database, PREFLIGHT);
    assert.deepEqual(present(), [true, true, true, true, true]);
  });

  await check("a partial state and a premature rollback are refused, changing nothing", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    const body = q("select pg_get_functiondef('api.get_hidden_sample_posts()'::regprocedure);");
    q("drop function api.get_hidden_sample_posts();");
    const rows = preflight();
    assert.equal(
      rows[0][1],
      "remove sample post hide list: unexpected state",
      JSON.stringify(rows)
    );
    assert.equal(rows.length, 6, JSON.stringify(rows));
    assert.match(fails(step.sql, "55000"), /remove sample post hide list precondition: 4 of 5/);
    q(body);
    q(`revoke all on function api.get_hidden_sample_posts() from public, anon, authenticated, service_role;
      grant execute on function api.get_hidden_sample_posts() to anon;
      grant execute on function api.get_hidden_sample_posts() to authenticated;`);
    assert.equal(fingerprint(), before);
    assert.equal(q(`select count(*) from ${TABLE};`), "1");
  });

  await check("apply, roll back and apply again are clean", () =>
    applyWithRollbackCheck(database, {
      step,
      rollback: ROLLBACK,
      label: "remove sample post hide list",
      fingerprint,
      preflightRows: preflight,
      appliedSummary: /^remove sample post hide list: already applied$/,
      repeatRollback: false,
    })
  );

  await check("afterwards the table and the four functions are gone for everyone", () => {
    assert.deepEqual(present(), [false, false, false, false, false]);
    const visitor = syntheticMember("removed-sample-member");
    fails("set role anon;\nselect api.get_hidden_sample_posts();", "42883");
    fails(member(visitor, "select api.get_hidden_sample_posts();"), "42883");
    fails(member(visitor, "select api.set_sample_post_hidden('removed-sample', true);"), "42883");
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the hide-list removed", () => {
      assert.deepEqual(present(), [false, false, false, false, false]);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Sample post hide-list removal checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
