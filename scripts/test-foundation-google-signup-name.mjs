#!/usr/bin/env node
// Behaviour checks for 20261112181954_google_name_at_signup.sql: a new
// profile takes its display name from the sign-up details Google gives
// (full_name, name, given_name + family_name) when the website's own
// display_name is absent or fails the person name rule, and existing profiles
// without a name are named once from the same details.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, creates Auth users as GoTrue would (the profile trigger runs on the
// insert), runs the update's read-only preflight, applies the update, checks
// the names new and existing profiles get, that a page holding a profile's
// earlier revision is refused, and proves that apply -> rollback -> apply
// returns the schema fingerprint to the same values each time. Any later
// updates are applied at the end and a Google sign-up is checked again.
//
//   node --import tsx scripts/test-foundation-google-signup-name.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Auth
// users, sessions and the locked legal name are written directly as the
// database owner; nothing contacts Google.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  assertReadOnlyPreflight,
  createChecks,
  sqlHelpers,
  updateCheckViews,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261112181954_google_name_at_signup.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const TRIGGER = "internal.create_account_profile()";
const HELPER = "internal.signup_display_name(jsonb)";
// Combining acute accent, written as a code point so no tool rewrites it.
const ACUTE = String.fromCodePoint(0x301);

const begun = Date.now();
const { check, current, passed } = createChecks();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const views = updateCheckViews(database, current, { preflight: PREFLIGHT });
  const { q, json, fails, member } = sqlHelpers(database, current);
  const { fingerprint, bodyMd5: bodyOf } = views;
  const preflight = views.preflightRows;
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const jsonb = (value) => (value === null ? "null" : `${literal(JSON.stringify(value))}::jsonb`);

  // ------------------------------------------------------- synthetic world
  /** An Auth user created as GoTrue would; the profile trigger runs on the
   * insert. Returns { id, session } (a live session for member calls). */
  const signUp = (meta, { anonymous = false, deleted = false } = {}) =>
    json(`with u as (
        insert into auth.users(id,email,email_confirmed_at,is_anonymous,deleted_at,raw_user_meta_data)
        values(gen_random_uuid(),${anonymous ? "null" : "'signup-'||gen_random_uuid()||'@example.invalid'"},
          ${anonymous ? "null" : "now()"},${anonymous},${deleted ? "now()" : "null"},${jsonb(meta)})
        returning id),
      s as (insert into auth.sessions(id,user_id,aal) select gen_random_uuid(),id,'aal1' from u returning id,user_id)
      select jsonb_build_object('id',s.user_id,'session',s.id) from s;`);
  const profile = (user) =>
    json(
      `select coalesce((select jsonb_build_object('display_name',display_name,'revision',revision,` +
        `'legal_first_name',legal_first_name,'legal_last_name',legal_last_name,'locked',legal_name_locked_at is not null) ` +
        `from private.profiles where account_id='${user.id}'),'null'::jsonb);`
    );
  const nameOf = (user) => profile(user)?.display_name ?? null;
  const setMeta = (user, meta) =>
    q(`update auth.users set raw_user_meta_data=${jsonb(meta)} where id='${user.id}';`);
  const helper = (meta) =>
    q(`select coalesce(internal.signup_display_name(${jsonb(meta)}),'<null>');`);
  const grantsOf = (signatures) =>
    json(`select jsonb_object_agg(f, (select jsonb_object_agg(r, has_function_privilege(r,f,'execute'))
        from unnest(array['anon','authenticated','service_role']) r))
      from unnest(array[${signatures.map(literal).join(",")}]) f;`);
  const google = (full, extra = {}) => ({
    iss: "https://accounts.google.com",
    sub: "1234567890",
    email: "member@example.invalid",
    email_verified: true,
    full_name: full,
    name: full,
    avatar_url: "https://lh3.googleusercontent.com/a/example",
    picture: "https://lh3.googleusercontent.com/a/example",
    provider_id: "1234567890",
    ...extra,
  });

  // ------------------------------------------------------------ before
  const early = {};
  await check("before the update: Google sign-ups get no display name", () => {
    assert.equal(bodyOf(HELPER), "missing");
    early.google = signUp(google("Thando Dlamini"));
    early.nameOnly = signUp({ name: "Lindiwe Nkosi" });
    early.givenFamily = signUp({ given_name: "Sipho", family_name: "Ndlovu" });
    early.named = signUp({ display_name: "Lerato Mokoena" });
    early.invalid = signUp(google("12345"));
    early.reserved = signUp(google("Support Team"));
    early.deleted = signUp(google("Gone Member"), { deleted: true });
    early.anonymous = signUp(google("Anon Member"), { anonymous: true });
    early.locked = signUp({ display_name: "Nandi Zulu" });
    for (const key of ["google", "nameOnly", "givenFamily", "invalid", "reserved", "deleted"])
      assert.deepEqual(profile(early[key]), {
        display_name: null,
        revision: 1,
        legal_first_name: null,
        legal_last_name: null,
        locked: false,
      });
    assert.equal(nameOf(early.named), "Lerato Mokoena");
    // The trigger skips anonymous users; a profile made for one later (as a
    // profile command would) has no name.
    assert.equal(profile(early.anonymous), null);
    q(`insert into private.profiles(account_id) values('${early.anonymous.id}');`);
    // A reviewed legal name lock, written directly (the identity review is
    // not part of this check): it always comes with its display name.
    q(`set session_replication_role=replica;
      update private.profiles set legal_first_name='Nandi',legal_last_name='Zulu',display_name='Nandi Zulu',
        legal_name_locked_at=clock_timestamp(),legal_name_fact_id=gen_random_uuid(),revision=revision+1
        where account_id='${early.locked.id}';
      set session_replication_role=origin;`);
    // Later sign-up details never rename a named or locked profile.
    setMeta(early.named, google("Someone Else"));
    setMeta(early.locked, google("Other Person"));
    early.snapshot = Object.fromEntries(
      Object.entries(early).map(([key, user]) => [key, profile(user)])
    );
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      "google name at signup: reviewed body, update not applied; profiles without a name: 7; of which the update names: 3"
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    const live = q(`select pg_get_functiondef('${TRIGGER}'::regprocedure);`);
    // The same function with one more space at the start of its body.
    q(
      `do $$begin execute replace(pg_get_functiondef('${TRIGGER}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[1][1], /create_account_profile\(\) is not the reviewed body/);
    assert.match(fails(step.sql, "55000"), /profile trigger drift/);
    q(`${live};`);
    // A helper of the same name with another body.
    q(`create function internal.signup_display_name(p_meta jsonb) returns text language sql
        set search_path=pg_catalog as $$ select 'Admin'::text $$;`);
    assert.match(preflight()[1][1], /signup_display_name\(jsonb\) is not the reviewed body/);
    assert.match(fails(step.sql, "55000"), /signup_display_name exists with another body/);
    q(`drop function internal.signup_display_name(jsonb);`);
    assert.equal(fingerprint(), before);
    assert.deepEqual(
      Object.fromEntries(Object.entries(early.snapshot).map(([key]) => [key, profile(early[key])])),
      early.snapshot
    );
  });

  // ------------------------------------------------------------- apply
  const before = fingerprint();
  const triggerGrants = grantsOf([TRIGGER]);
  applySteps(database, [step]);
  const after = fingerprint();

  await check("preflight after the update: already applied, nothing left to name", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      "google name at signup: already applied; profiles without a name: 4; of which the update names: 0"
    );
  });
  await check("the one-time fill names unnamed, unlocked profiles once", () => {
    const filled = {
      google: "Thando Dlamini",
      nameOnly: "Lindiwe Nkosi",
      givenFamily: "Sipho Ndlovu",
    };
    for (const [key, name] of Object.entries(filled))
      assert.deepEqual(profile(early[key]), {
        ...early.snapshot[key],
        display_name: name,
        revision: early.snapshot[key].revision + 1,
      });
    // Named, locked, anonymous, deleted, invalid and reserved: untouched.
    for (const key of ["named", "locked", "anonymous", "deleted", "invalid", "reserved"])
      assert.deepEqual(profile(early[key]), early.snapshot[key], key);
    assert.equal(nameOf(early.named), "Lerato Mokoena");
    assert.deepEqual(profile(early.locked), {
      display_name: "Nandi Zulu",
      revision: 2,
      legal_first_name: "Nandi",
      legal_last_name: "Zulu",
      locked: true,
    });
  });
  await check("a page holding the earlier revision is refused, the new one saves", () => {
    const old = early.snapshot.google.revision;
    fails(
      member(early.google, `select api.save_my_profile(${old},'Thando D Dlamini',null);`),
      "PT409",
      /profile changed; reload it/
    );
    assert.equal(nameOf(early.google), "Thando Dlamini");
    const saved = json(
      member(early.google, `select api.save_my_profile(${old + 1},'Thando Mandla Dlamini',null);`)
    );
    assert.equal(saved.display_name, "Thando Mandla Dlamini");
    assert.equal(profile(early.google).revision, old + 2);
  });
  await check("new sign-ups: the first sign-up name that passes the rule", () => {
    const cases = [
      ["Google full_name and name", google("Ayanda Khumalo"), "Ayanda Khumalo"],
      ["full_name only", { full_name: "Bongani Mthembu" }, "Bongani Mthembu"],
      ["name only", { name: "Zanele Mahlangu" }, "Zanele Mahlangu"],
      [
        "given_name and family_name",
        { given_name: "Kagiso", family_name: "Molefe" },
        "Kagiso Molefe",
      ],
      ["parts are trimmed", { given_name: " Kagiso ", family_name: " Molefe" }, "Kagiso Molefe"],
      [
        "display_name wins over full_name",
        { display_name: "Thabo M", ...google("Thabo Mokoena") },
        "Thabo M",
      ],
      [
        "full_name wins over name",
        { full_name: "Naledi Sithole", name: "Naledi S" },
        "Naledi Sithole",
      ],
      [
        "name wins over the parts",
        { name: "Pieter Botha", given_name: "Piet", family_name: "Botha" },
        "Pieter Botha",
      ],
      [
        "invalid display_name falls back",
        { display_name: "!!", full_name: "Ayanda Khumalo" },
        "Ayanda Khumalo",
      ],
      [
        "reserved display_name falls back",
        { display_name: "Site Admin", full_name: "Ayanda Khumalo" },
        "Ayanda Khumalo",
      ],
      [
        "invalid full_name falls back to name",
        { full_name: "Ayanda 2", name: "Ayanda Khumalo" },
        "Ayanda Khumalo",
      ],
      [
        "trimmed and NFC normalised",
        { full_name: `  Zoe${ACUTE} Smith ` },
        `Zo${String.fromCodePoint(0xe9)} Smith`,
      ],
      ["apostrophe, dot and hyphen", { full_name: "Mary-Jane O'Neil Jr." }, "Mary-Jane O'Neil Jr."],
      ["all invalid", google("1234"), null],
      ["reserved only", google("VerifyMzansi Support"), null],
      ["staff word", { full_name: "Official Thando" }, null],
      ["too long", { full_name: `${"A".repeat(30)} ${"B".repeat(30)}` }, null],
      ["one letter", { full_name: "A" }, null],
      ["inner double space", { full_name: "Thando  Dlamini" }, null],
      ["tab inside", { full_name: "Thando\tDlamini" }, null],
      [
        "not a string",
        { full_name: 42, name: ["Thando"], display_name: { first: "Thando" } },
        null,
      ],
      ["given_name alone", { given_name: "Thando" }, null],
      ["empty given_name", { given_name: " ", family_name: "Dlamini" }, null],
      ["no details", {}, null],
      ["null details", null, null],
      ["an array", ["Thando Dlamini"], null],
    ];
    for (const [label, meta, expected] of cases) {
      assert.equal(helper(meta), expected ?? "<null>", `helper: ${label}`);
      assert.equal(nameOf(signUp(meta)), expected, `sign-up: ${label}`);
    }
    // Anonymous users still get no profile.
    assert.equal(profile(signUp(google("Anon Person"), { anonymous: true })), null);
  });
  await check("sign-up details carry no authority", () => {
    const user = signUp({
      ...google("Ayanda Khumalo"),
      legal_first_name: "Ayanda",
      legal_last_name: "Khumalo",
      legal_name_locked_at: "2026-11-12T00:00:00Z",
      role: "admin",
      roles: ["admin"],
      is_verified: true,
    });
    assert.deepEqual(profile(user), {
      display_name: "Ayanda Khumalo",
      revision: 1,
      legal_first_name: null,
      legal_last_name: null,
      locked: false,
    });
    assert.equal(q(`select count(*) from private.staff_roles where user_id='${user.id}';`), "0");
    // A member can still change the name like any other.
    const saved = json(member(user, `select api.save_my_profile(1,'Ayanda K',null);`));
    assert.equal(saved.display_name, "Ayanda K");
  });
  await check("who may run the helper and the trigger", () => {
    const nobody = { anon: false, authenticated: false, service_role: false };
    assert.deepEqual(grantsOf([HELPER]), { [HELPER]: nobody });
    assert.deepEqual(grantsOf([TRIGGER]), triggerGrants);
    const meta =
      json(`select jsonb_build_object('definer',prosecdef,'volatility',provolatile,'owner',proowner::regrole::text,
        'config',proconfig) from pg_proc where oid='${HELPER}'::regprocedure;`);
    assert.deepEqual(meta, {
      definer: false,
      volatility: "i",
      owner: "postgres",
      config: ["search_path=pg_catalog"],
    });
    assert.equal(
      q(
        `select count(*) from pg_trigger where tgname='create_account_profile' and tgrelid='auth.users'::regclass;`
      ),
      "1"
    );
  });
  await check("apply, roll back and apply again are clean", () => {
    // A repeated run names nobody twice and changes nothing.
    const named = profile(early.nameOnly);
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
    assert.deepEqual(profile(early.nameOnly), named);
    applySteps(database, [{ label: "google name at signup rollback", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before, "the rollback leaves the pre-update schema");
    assert.equal(bodyOf(HELPER), "missing");
    assert.match(preflight()[0][1], /^google name at signup: reviewed body, update not applied;/);
    // Names given by the fill stay; Google sign-ups get no name again.
    assert.deepEqual(profile(early.nameOnly), named);
    const unnamed = signUp(google("Rolled Back"));
    assert.equal(nameOf(unnamed), null);
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    assert.equal(nameOf(unnamed), "Rolled Back");
    assert.equal(nameOf(signUp(google("Applied Again"))), "Applied Again");
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep Google names at sign-up", () => {
      assert.equal(nameOf(signUp(google("Later Member"))), "Later Member");
      assert.equal(nameOf(early.named), "Lerato Mokoena");
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Google sign-up name checks passed: ${passed.length} in ${Math.round((Date.now() - begun) / 1000)} s.`
);
