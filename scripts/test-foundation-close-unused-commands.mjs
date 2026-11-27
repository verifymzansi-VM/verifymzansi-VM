#!/usr/bin/env node
// Behaviour checks for 20261127222829_close_unused_commands.sql, a contract
// step: eight api commands the website replaced earlier are removed, with the
// three internal functions only they called; the five other internal functions
// behind them lose their execute grant to authenticated; and the staff role
// review returns each person's short name instead of the full name and email.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. The script runs the update's read-only preflight, checks that a partial
// state and another role review body are refused, applies the update, proves a
// second run changes nothing, and checks the role review and the replacement
// commands as staff and as a member. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-close-unused-commands.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  assertReadOnlyPreflight,
  openUpdateCheck,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261127222829_close_unused_commands.sql";
const PREFLIGHT = readFileSync(
  `database/foundation/preflight/${UPDATE.replace(/\.sql$/, ".check.sql")}`,
  "utf8"
);
const DROPPED = [
  "api.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean)",
  "api.get_my_frontend_posting_allowance(text)",
  "api.get_frontend_report_queue(text)",
  "api.list_my_frontend_notifications(integer,boolean,timestamptz)",
  "api.get_frontend_seen_queue(text)",
  "api.get_my_frontend_business_checks(uuid)",
  "api.release_frontend_content_hold(uuid,integer,text)",
  "api.open_identity_disclosure(text,text,text,text,text,boolean)",
  "internal.get_my_frontend_posting_allowance(text)",
  "internal.list_my_frontend_notifications(integer,boolean,timestamptz)",
  "internal.open_identity_disclosure(text,text,text,text,text,boolean)",
];
const KEPT = [
  "internal.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean)",
  "internal.get_frontend_report_queue(text)",
  "internal.get_frontend_seen_queue(text)",
  "internal.get_my_frontend_business_checks(uuid)",
  "internal.release_frontend_content_hold(uuid,integer,text)",
];
const REVIEW = "internal.get_frontend_staff_role_review(integer,text)";
const REVIEWED_BODY = "f2d542319179e14457c863d7392e7dd3";
const UPDATED_BODY = "6e80f5cf89c78c9032bd42c3f2632ef4";
const summary = (state, present, granted) =>
  `close unused commands: ${state}; functions to drop present: ${present} of 11; kept internal functions executable by authenticated: ${granted} of 5`;

const {
  started,
  database,
  check,
  current,
  passed: checks,
  q,
  json,
  fails,
  member,
  staff,
  fingerprint,
  bodyMd5,
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  // Every update before this one, as production has them.
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const present = () =>
    DROPPED.filter((sig) => q(`select to_regprocedure('${sig}') is not null;`) === "t").length;
  const granted = () =>
    KEPT.filter(
      (sig) => q(`select has_function_privilege('authenticated','${sig}','execute');`) === "t"
    ).length;

  // Synthetic people, written as the database owner: an admin with a profile
  // name, a moderator without one, and a member.
  syntheticMember("setup");
  q(`create or replace function vmtest.staff_member(p_label text,p_role text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      update auth.sessions set aal='aal2' where id=(m->>'session')::uuid;
      insert into auth.mfa_factors(user_id,factor_type,status) values((m->>'id')::uuid,'totp','verified');
      insert into private.staff_roles(user_id,role) values((m->>'id')::uuid,p_role);
      return m;
    end$$;`);
  const admin = json(`select vmtest.staff_member('reviewer','admin');`);
  const nameless = json(`select vmtest.staff_member('nameless','moderator');`);
  const someone = syntheticMember("member");
  q(`update private.profiles set display_name='Thando Dlamini' where account_id='${admin.id}';
    update private.profiles set display_name=null where account_id='${nameless.id}';`);
  const review = () => json(staff(admin, "select api.get_frontend_staff_role_review(1,null);"));

  await check("before the update: preflight reads 'not applied' and is read only", () => {
    assert.deepEqual(preflight(), [["summary", summary("update not applied", 11, 5)]]);
    assertReadOnlyPreflight(database, PREFLIGHT);
    assert.equal(bodyMd5(REVIEW), REVIEWED_BODY);
    // The reviewed body still names people by full name and email address.
    const people = review().people;
    assert.ok(people.length >= 2, JSON.stringify(people));
    assert.ok(people.every((p) => "email" in p));
  });

  await check("a partial state or another role review body is refused, changing nothing", () => {
    const before = fingerprint();
    const sig = "api.get_frontend_report_queue(text)";
    const command = q(`select pg_get_functiondef('${sig}'::regprocedure);`);
    q(`drop function ${sig};`);
    assert.match(
      fails(step.sql, "55000"),
      /close unused commands precondition: 10 of 11 functions exist/
    );
    q(command);
    q(`revoke all on function ${sig} from public;
      grant execute on function ${sig} to authenticated;`);
    const body = q(`select pg_get_functiondef('${REVIEW}'::regprocedure);`);
    q(body.replace("declare actor", " declare actor"));
    assert.notEqual(bodyMd5(REVIEW), REVIEWED_BODY);
    assert.match(fails(step.sql, "55000"), /role review body/);
    q(body);
    assert.equal(bodyMd5(REVIEW), REVIEWED_BODY);
    assert.equal(fingerprint(), before);
  });

  await check("apply: preflight reads 'already applied'; a second run changes nothing", () => {
    applySteps(database, [step]);
    const after = fingerprint();
    assert.deepEqual(preflight(), [["summary", summary("already applied", 0, 0)]]);
    assert.equal(present(), 0);
    assert.equal(granted(), 0);
    assert.equal(bodyMd5(REVIEW), UPDATED_BODY);
    applySteps(database, [step]);
    assert.equal(fingerprint(), after);
  });

  await check("role review: each person is exactly user_id and a short name", () => {
    const people = review().people;
    for (const person of people)
      assert.deepEqual(Object.keys(person).sort(), ["display_name", "user_id"]);
    const byId = new Map(people.map((p) => [p.user_id, p.display_name]));
    assert.equal(byId.get(admin.id), "Thando D.");
    assert.ok(byId.has(nameless.id));
    assert.equal(byId.get(nameless.id), null);
  });

  await check("the kept internals are not for authenticated; the replacements still work", () => {
    fails(staff(admin, "select internal.get_frontend_report_queue(null);"), "42501");
    fails(staff(admin, "select internal.get_frontend_seen_queue('visits');"), "42501");
    // Both staff queues reach the kept internals through their definer functions.
    assert.equal(
      typeof json(staff(admin, "select api.get_frontend_report_review_queue(null);")),
      "object"
    );
    assert.equal(
      typeof json(staff(admin, "select api.get_frontend_business_review_queue('visits');")),
      "object"
    );
    assert.ok(
      Array.isArray(
        json(member(someone, "select api.list_my_frontend_notices(10,false,null);")).items
      )
    );
    fails(member(someone, "select api.list_my_frontend_notifications(10,false,null);"), "42883");
    fails(staff(admin, "select api.get_frontend_report_queue(null);"), "42883");
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the commands removed", () => {
      assert.equal(present(), 0);
      assert.equal(granted(), 0);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Close unused commands checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
