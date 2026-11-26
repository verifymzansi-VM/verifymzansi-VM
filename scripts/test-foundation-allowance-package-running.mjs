#!/usr/bin/env node
// Behaviour checks for 20261126202833_allowance_says_package_running.sql
// (launch checklist item 80): api.get_my_frontend_posting_allowance_v2 says
// whether the caller's Multi-listing package is running (package_running),
// by the same rule as api.list_my_post_templates, and nothing else in the
// answer changes.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members are written directly as the database owner (an accepted ID
// review as a synthetic identity fact); a package and an Individual slot are
// bought through the checkouts and a synthetic Ozow notice, as the website's
// server does. The script checks the read-only preflight, a drifted body and a
// premature rollback, applies the update and proves apply -> rollback ->
// apply, then: true while a package runs (in every posting area), false for a
// member without one and for an Individual slot holder, false once the package
// has ended, always the same as the template list's answer.
//
//   node --import tsx scripts/test-foundation-allowance-package-running.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import { assertReadOnlyPreflight } from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  P30,
  applyAndProveRollback,
  assertDriftRefused,
  buyPackage,
  functionBodyMd5,
  ozowPurchase,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261126202833_allowance_says_package_running.sql";
const ALLOWANCE = "internal.get_my_frontend_posting_allowance_v2(text)";
const BODIES = ["18edc8cd354b8990c7b557fa4f00eea3", "76cb38d3421bb1910b1cd40a2d85082c"];
const LABEL = "package running in the allowance";
const NOT_APPLIED = /^package running in the allowance: update not applied; packages running: \d+$/;
const APPLIED = /^package running in the allowance: already applied; packages running: \d+$/;

const SETUP = { update: UPDATE, label: "allowancepkg", title: "Package running in the allowance" };
await runTwoAdminUpdateCheck(SETUP, async ({ database, check, kit, world, admin }) => {
  const { q, json, member, preflight } = kit;
  const allowance = (who, area = "market") =>
    json(member(who, `select api.get_my_frontend_posting_allowance_v2('${area}');`));
  const templatesSay = (who) =>
    json(member(who, `select api.list_my_post_templates();`)).package_running;

  // ------------------------------------------------------------- world
  q(
    `update private.slot_package_sales set on_sale=true,changed_at=now(),reason='Fixture: switched for the checks';`
  );
  const sipho = world.verified("pkg-sipho", admin);
  buyPackage(kit, sipho, 5);
  const thandi = world.verified("pkg-thandi", admin);
  ozowPurchase(kit, thandi, P30, 1);
  const nomsa = world.verified("pkg-nomsa", admin);
  const people = { sipho, thandi, nomsa };
  const before = {};

  // ------------------------------------------------------------ before
  await check("before the update: the reviewed body, no package_running", () => {
    assert.equal(functionBodyMd5(kit, ALLOWANCE), BODIES[0]);
    for (const [name, who] of Object.entries(people)) {
      before[name] = allowance(who);
      assert.equal("package_running" in before[name], false, name);
    }
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(rows[0][1], "package running in the allowance: update not applied; packages running: 1");
    assertReadOnlyPreflight(database, kit.preflightSql);
  });
  await check("a premature rollback and a drifted body are refused", () => {
    assertDriftRefused(kit, { label: LABEL, signatures: [ALLOWANCE], rows: 2 });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: LABEL,
    applied: APPLIED,
    notApplied: NOT_APPLIED,
  });

  // ------------------------------------------------------------- after
  await check("one key added; the rest of the answer is unchanged", () => {
    assert.equal(functionBodyMd5(kit, ALLOWANCE), BODIES[1]);
    const expected = { sipho: true, thandi: false, nomsa: false };
    for (const [name, who] of Object.entries(people)) {
      const { package_running: running, ...rest } = allowance(who);
      assert.equal(running, expected[name], name);
      assert.deepEqual(rest, before[name], name);
      assert.equal(running, templatesSay(who), `${name}: same as the template list`);
    }
  });

  await check("a running package shows in every posting area", () => {
    for (const area of ["market", "business", "tourism_events"])
      assert.equal(allowance(sipho, area).package_running, true, area);
  });

  await check("after the package ends: false, like the template list", () => {
    q(`update private.entitlements set ends_at=now()-interval '1 minute',starts_at=now()-interval '31 days'
         where owner_id='${sipho.id}' and package_id is not null;`);
    assert.equal(allowance(sipho).package_running, false);
    assert.equal(templatesSay(sipho), false);
    assert.match(preflight()[0][1], /; packages running: 0$/);
  });

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the package_running key", () => {
      assert.equal(typeof allowance(nomsa).package_running, "boolean");
    });
  }
});
