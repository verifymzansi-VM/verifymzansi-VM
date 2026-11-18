#!/usr/bin/env node
// Behaviour checks for 20261117144001_sample_post_hide_list.sql: staff remove
// a display-only sample post (by its catalogue slug) and restore it; the
// public read returns the removed slugs only.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Staff act through the production command api.set_sample_post_hidden
// with synthetic AAL2 sessions and a verified authenticator app; visitors and
// members read through api.get_hidden_sample_posts. The script runs the
// read-only preflight, checks its refusals, applies the update, proves apply ->
// rollback -> apply returns the same fingerprints, then checks who may hide,
// restore and read, the slug rule and the limit. Any later updates are applied
// at the end.
//
//   node --import tsx scripts/test-foundation-sample-post-hide-list.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertReadOnlyPreflight,
  executeGrants,
  openUpdateCheck,
  sqlLiteral,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261117144001_sample_post_hide_list.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const SET = "api.set_sample_post_hidden(text,boolean)";
const READ = "api.get_hidden_sample_posts()";
const SIGNATURES = [
  "internal.set_sample_post_hidden(text,boolean)",
  SET,
  "internal.get_hidden_sample_posts()",
  READ,
];

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
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);

  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(rows, [["summary", "sample post hide list: update not applied"]]);
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("a partial state and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    q("create table private.hidden_sample_posts(slug text primary key);");
    const rows = preflight();
    assert.equal(rows[0][1], "sample post hide list: unexpected state", JSON.stringify(rows));
    assert.equal(rows.length, 6, JSON.stringify(rows));
    assert.match(fails(step.sql, "55000"), /sample post hide list precondition: 1 of 5/);
    q("drop table private.hidden_sample_posts;");
    assert.equal(fingerprint(), before);
  });

  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "sample post hide list",
    fingerprint,
    preflightRows: preflight,
    appliedSummary: /^sample post hide list: already applied; hidden samples: 0$/,
    repeatRollback: false,
  });

  // ------------------------------------------------------- synthetic world
  /** A staff member with a verified authenticator app and an AAL2 session. */
  const staffUser = (label, role) => {
    const user = syntheticMember(label);
    q(`update auth.sessions set aal='aal2' where id='${user.session}';
      insert into auth.mfa_factors(user_id,factor_type,status) values('${user.id}','totp','verified');
      insert into private.staff_roles(user_id,role) values('${user.id}','${role}');`);
    return user;
  };
  const setSql = (slug, hidden) =>
    `select api.set_sample_post_hidden(${slug === null ? "null" : sqlLiteral(slug)},${hidden});`;
  const hide = (user, slug, hidden = true, totpAt) =>
    json(staff(user, setSql(slug, hidden), totpAt));
  const anonRead = () => json(`set role anon;\nselect ${READ};`);
  const rows = () =>
    json(`select coalesce(jsonb_agg(jsonb_build_object('slug',slug,'by',hidden_by,'at',hidden_at)
        order by slug),'[]') from private.hidden_sample_posts;`);

  const moderator = staffUser("sample-moderator", "moderator");
  const admin = staffUser("sample-admin", "admin");
  const visitor = syntheticMember("sample-member");

  await check("staff hide a sample once; repeats keep the first who and when", () => {
    const first = hide(moderator, "fish-braai-durban");
    assert.equal(first.slug, "fish-braai-durban");
    assert.equal(first.hidden, true);
    assert.ok(first.hidden_at);
    assert.deepEqual(hide(moderator, "fish-braai-durban"), first);
    assert.deepEqual(hide(admin, "fish-braai-durban"), first);
    assert.deepEqual(
      rows().map(({ slug, by }) => [slug, by]),
      [["fish-braai-durban", moderator.id]]
    );
  });
  await check("the public read lists hidden slugs only, sorted, for visitors and members", () => {
    hide(admin, "a-cape-town-guesthouse");
    const expected = { slugs: ["a-cape-town-guesthouse", "fish-braai-durban"] };
    assert.deepEqual(anonRead(), expected);
    assert.deepEqual(json(member(visitor, `select ${READ};`)), expected);
    assert.deepEqual(json(staff(admin, `select ${READ};`)), expected);
  });
  await check("staff restore a sample; repeats change nothing", () => {
    const restored = hide(moderator, "a-cape-town-guesthouse", false);
    assert.deepEqual(restored, { slug: "a-cape-town-guesthouse", hidden: false, hidden_at: null });
    assert.deepEqual(hide(admin, "a-cape-town-guesthouse", false), restored);
    assert.deepEqual(hide(admin, "never-hidden-slug", false), {
      slug: "never-hidden-slug",
      hidden: false,
      hidden_at: null,
    });
    assert.deepEqual(anonRead(), { slugs: ["fish-braai-durban"] });
  });
  await check("anyone but current staff with a recent code is refused, changing nothing", () => {
    const before = rows();
    fails(`set role anon;\n${setSql("fish-braai-durban", false)}`, "42501");
    fails(member(visitor, setSql("fish-braai-durban", false)), "42501", /staff session/);
    fails(member(visitor, setSql("member-sample", true)), "42501");
    // Staff whose last authenticator code is older than 15 minutes.
    const stale = Math.floor(Date.now() / 1000) - 20 * 60;
    fails(
      staff(moderator, setSql("fish-braai-durban", false), stale),
      "42501",
      /recent second-factor verification required/
    );
    // A revoked role grants nothing.
    const former = staffUser("sample-former", "moderator");
    q(
      `update private.staff_roles set revoked_at=now(),revoked_by='${admin.id}' where user_id='${former.id}';`
    );
    fails(staff(former, setSql("fish-braai-durban", false)), "42501", /capability not granted/);
    // Staff without a verified authenticator app.
    const noApp = staffUser("sample-no-app", "admin");
    q(`delete from auth.mfa_factors where user_id='${noApp.id}';`);
    fails(staff(noApp, setSql("fish-braai-durban", false)), "42501", /authenticator app/);
    assert.deepEqual(rows(), before);
  });
  await check("malformed slugs are refused", () => {
    const before = rows();
    for (const slug of [
      null,
      "ab",
      "AB-CD",
      "a--b",
      "-abc",
      "abc-",
      "abc_d",
      "abc d",
      "x".repeat(81),
    ])
      fails(staff(admin, setSql(slug, true)), "22023", /invalid sample post/);
    fails(staff(admin, `select api.set_sample_post_hidden('abc',null);`), "22023");
    assert.deepEqual(rows(), before);
    // The longest and shortest valid slugs are accepted.
    hide(admin, "x".repeat(80));
    hide(admin, "abc");
    hide(admin, "x".repeat(80), false);
    hide(admin, "abc", false);
  });
  await check("at most 500 slugs are hidden", () => {
    q(`insert into private.hidden_sample_posts(slug)
        select 'filler-'||g from generate_series(1,499) g;`);
    assert.equal(anonRead().slugs.length, 500);
    fails(staff(admin, setSql("one-too-many", true)), "54000", /too many hidden sample posts/);
    // Already hidden: still idempotent at the limit.
    assert.equal(hide(admin, "fish-braai-durban").hidden, true);
    hide(admin, "filler-1", false);
    assert.equal(hide(admin, "one-too-many").hidden, true);
    q(`delete from private.hidden_sample_posts where slug like 'filler-%' or slug='one-too-many';`);
  });
  await check("a deleted staff account leaves the hidden slug without its author", () => {
    const leaver = staffUser("sample-leaver", "moderator");
    hide(leaver, "leaver-sample");
    q(`delete from private.staff_roles where user_id='${leaver.id}';
      delete from auth.users where id='${leaver.id}';`);
    assert.deepEqual(
      rows().map(({ slug, by }) => [slug, by]),
      [
        ["fish-braai-durban", moderator.id],
        ["leaver-sample", null],
      ]
    );
    hide(admin, "leaver-sample", false);
  });
  await check("grants, owners, settings and table access", () => {
    assert.deepEqual(executeGrants(json, SIGNATURES), {
      "internal.set_sample_post_hidden(text,boolean)": {
        anon: false,
        authenticated: true,
        service_role: false,
      },
      [SET]: { anon: false, authenticated: true, service_role: false },
      "internal.get_hidden_sample_posts()": {
        anon: true,
        authenticated: true,
        service_role: false,
      },
      [READ]: { anon: true, authenticated: true, service_role: false },
    });
    for (const signature of SIGNATURES) {
      const meta =
        json(`select jsonb_build_object('definer',prosecdef,'owner',proowner::regrole::text,'config',proconfig)
          from pg_proc where oid='${signature}'::regprocedure;`);
      assert.deepEqual(meta, {
        definer: signature.startsWith("internal."),
        owner: "postgres",
        config: ["search_path=pg_catalog"],
      });
    }
    assert.deepEqual(
      json(`select jsonb_build_object('rls',relrowsecurity,'owner',relowner::regrole::text,
          'access',(select jsonb_object_agg(r, has_table_privilege(r,'private.hidden_sample_posts',
            'select,insert,update,delete')) from unnest(array['anon','authenticated','service_role']) r))
        from pg_class where oid='private.hidden_sample_posts'::regclass;`),
      {
        rls: true,
        owner: "postgres",
        access: { anon: false, authenticated: false, service_role: false },
      }
    );
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the hide-list", () => {
      const keeper = staffUser("sample-later", "governor");
      hide(keeper, "later-sample");
      assert.ok(anonRead().slugs.includes("later-sample"));
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Sample post hide-list checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
