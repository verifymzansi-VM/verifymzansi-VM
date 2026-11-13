#!/usr/bin/env node
// Behaviour checks for 20261113134500_communication_choices_and_signup_terms.sql:
// members save their optional communication choices (off until turned on,
// every change kept with its wording version and time), read only their own
// choices and finished account emails, and every new account records the
// Terms version it accepted at sign-up (website form or Google).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, runs the update's read-only preflight, applies the update, checks the
// commands as members, anon and service_role with synthetic sessions, creates
// Auth users as GoTrue would (the trigger runs on the insert), and proves that
// apply -> rollback -> apply returns the schema fingerprint to the same values
// each time. Any later updates are applied at the end and checked again.
//
//   node --import tsx scripts/test-foundation-communication-choices.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Auth
// users, sessions and queued emails are written directly as the database
// owner; nothing is sent.
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

const UPDATE = "20261113134500_communication_choices_and_signup_terms.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const WORDING = "communication-2026-11";
const FUNCTIONS = [
  "internal.guard_consent_record()",
  "internal.communication_choices_dto(uuid)",
  "internal.get_my_communication_choices()",
  "api.get_my_communication_choices()",
  "internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean)",
  "api.save_my_communication_choices(text,boolean,boolean,boolean,boolean)",
  "internal.list_my_email_history(integer)",
  "api.list_my_email_history(integer)",
  "internal.record_signup_terms()",
];
const ALL_OFF = {
  marketing_email: false,
  marketing_sms: false,
  analytics: false,
  third_party_sharing: false,
};

const begun = Date.now();
const { check, current, passed } = createChecks();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const views = updateCheckViews(database, current, { preflight: PREFLIGHT });
  const { q, json, fails, member, as, claims, service } = sqlHelpers(database, current);
  const { fingerprint, bodyMd5: bodyOf } = views;
  const preflight = views.preflightRows;
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const jsonb = (value) => (value === null ? "null" : `${literal(JSON.stringify(value))}::jsonb`);

  // ------------------------------------------------------- synthetic world
  /** An Auth user created as GoTrue would (user and app details on the same
   * insert); returns { id, session } with a live session. */
  const signUp = (meta, app, { anonymous = false } = {}) =>
    json(`with u as (
        insert into auth.users(id,email,email_confirmed_at,is_anonymous,raw_user_meta_data,raw_app_meta_data)
        values(gen_random_uuid(),${anonymous ? "null" : "'signup-'||gen_random_uuid()||'@example.invalid'"},
          ${anonymous ? "null" : "now()"},${anonymous},${jsonb(meta)},${jsonb(app)})
        returning id),
      s as (insert into auth.sessions(id,user_id,aal) select gen_random_uuid(),id,'aal1' from u returning id,user_id)
      select jsonb_build_object('id',s.user_id,'session',s.id) from s;`);
  const emailApp = { provider: "email", providers: ["email"] };
  const googleApp = { provider: "google", providers: ["google"] };
  const formSignUp = () =>
    signUp({ display_name: "Thando Dlamini", terms_accepted: true }, emailApp);
  const googleSignUp = () =>
    signUp(
      { iss: "https://accounts.google.com", full_name: "Lindiwe Nkosi", email_verified: true },
      googleApp
    );
  const acceptance = (user) =>
    json(`select coalesce((select jsonb_build_object('version',version,'document_hash',document_hash,'method',method)
        from private.signup_terms_acceptances where account_id='${user.id}'),'null'::jsonb);`);
  const currentTerms = () =>
    json(`select jsonb_build_object('version',v.version,'document_hash',v.document_hash)
      from private.posting_terms_current c join private.posting_terms_versions v using(version) where c.singleton;`);
  const choices = (user) => json(member(user, `select api.get_my_communication_choices();`));
  const save = (user, args, wording = WORDING) =>
    json(
      member(
        user,
        `select api.save_my_communication_choices(${literal(wording)}${Object.entries(args)
          .map(([key, value]) => `,p_${key}=>${value === null ? "null" : value}`)
          .join("")});`
      )
    );
  const events = (user) =>
    json(`select coalesce(jsonb_agg(jsonb_build_array(purpose,granted,wording_version) order by recorded_at,id),'[]')
      from private.communication_choice_events where account_id='${user.id}';`);
  const history = (user, limit = 20) =>
    json(member(user, `select api.list_my_email_history(${limit});`));
  const queue = (user, kind, { processed = false, attempts = 1 } = {}) =>
    q(`insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key,processed_at,delivery_attempts,delivery_error)
        values('${kind}',gen_random_uuid(),'${user.id}','vmtest:'||gen_random_uuid(),
          ${processed ? "statement_timestamp()" : "null"},${attempts},${processed ? "null" : "'delivery_failed'"})
        returning id;`);
  const grantsOf = (signatures) =>
    json(`select jsonb_object_agg(f, (select jsonb_object_agg(r, has_function_privilege(r,f,'execute'))
        from unnest(array['anon','authenticated','service_role']) r))
      from unnest(array[${signatures.map(literal).join(",")}]) f;`);
  const anon = (sql) => `set role anon;\n${sql}`;

  // ------------------------------------------------------------ before
  const early = {};
  await check("before the update: nothing records choices or sign-up Terms", () => {
    for (const signature of FUNCTIONS) assert.equal(bodyOf(signature), "missing", signature);
    assert.equal(q(`select to_regclass('private.communication_choice_events') is null;`), "t");
    early.form = formSignUp();
    early.google = googleSignUp();
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
      `communication choices and signup terms: update not applied; current terms: ${currentTerms().version}`
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    // A command of the same name with another body.
    q(`create function internal.list_my_email_history(p_limit integer default 20) returns jsonb
        language sql set search_path=pg_catalog as $$ select '{}'::jsonb $$;`);
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[1][1], /list_my_email_history\(integer\) is neither absent nor the update's/);
    assert.match(fails(step.sql, "55000"), /communication choices function drift/);
    q(`drop function internal.list_my_email_history(integer);`);
    // The member check changed.
    const live = q(`select pg_get_functiondef('internal.price_draft_actor()'::regprocedure);`);
    q(
      `do $$begin execute replace(pg_get_functiondef('internal.price_draft_actor()'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    assert.match(preflight()[1][1], /price_draft_actor\(\) is not the reviewed body/);
    assert.match(fails(step.sql, "55000"), /communication choices precondition/);
    q(`${live};`);
    // A table of the same name with another shape.
    q(`create table private.signup_terms_acceptances(account_id uuid primary key);
      alter table private.signup_terms_acceptances enable row level security;`);
    assert.match(fails(step.sql, "55000"), /communication choices table drift/);
    q(`drop table private.signup_terms_acceptances;`);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  const before = fingerprint();
  applySteps(database, [step]);
  const after = fingerprint();

  await check("preflight after the update: already applied, nothing recorded yet", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      `communication choices and signup terms: already applied; current terms: ${currentTerms().version}; ` +
        "choice changes recorded: 0; sign-up acceptances recorded: 0"
    );
  });
  await check("accounts made before the update are not given an acceptance", () => {
    assert.equal(acceptance(early.form), null);
    assert.equal(acceptance(early.google), null);
  });
  await check("sign-up records the current Terms: website form and Google", () => {
    const terms = currentTerms();
    assert.match(terms.version, /^posting-v\d+$/);
    assert.deepEqual(acceptance(formSignUp()), { ...terms, method: "email_form" });
    assert.deepEqual(acceptance(googleSignUp()), { ...terms, method: "google" });
    // A Google sign-up is recorded as Google whatever its details say.
    assert.deepEqual(acceptance(signUp({ terms_accepted: true }, googleApp)), {
      ...terms,
      method: "google",
    });
    // The form's detail recorded even if the provider detail is absent.
    assert.deepEqual(acceptance(signUp({ terms_accepted: true }, null)), {
      ...terms,
      method: "email_form",
    });
  });
  await check("no acceptance without the ticked box, and never for anonymous users", () => {
    const cases = [
      ["no details", {}, emailApp],
      ["null details", null, emailApp],
      ["box not ticked", { terms_accepted: false }, emailApp],
      ["a string, not true", { terms_accepted: "true" }, emailApp],
      ["a number", { terms_accepted: 1 }, emailApp],
      ["another provider", {}, { provider: "github" }],
    ];
    for (const [label, meta, app] of cases) assert.equal(acceptance(signUp(meta, app)), null, label);
    const anonymous = signUp({ terms_accepted: true }, googleApp, { anonymous: true });
    assert.equal(acceptance(anonymous), null);
    // Sign-up details cannot pick the version.
    const picked = signUp(
      { terms_accepted: true, version: "posting-v1", terms_version: "posting-v1" },
      emailApp
    );
    assert.equal(acceptance(picked).version, currentTerms().version);
  });
  await check("acceptances never change, and go with the Auth user", () => {
    const user = formSignUp();
    fails(
      `update private.signup_terms_acceptances set method='google' where account_id='${user.id}';`,
      "23514",
      /consent records are history/
    );
    q(`delete from auth.users where id='${user.id}';`);
    assert.equal(
      q(`select count(*) from private.signup_terms_acceptances where account_id='${user.id}';`),
      "0"
    );
  });
  await check("no API role reads or writes the new tables", () => {
    for (const role of ["anon", "authenticated", "service_role"])
      for (const table of ["communication_choice_events", "signup_terms_acceptances"]) {
        fails(`set role ${role};\nselect count(*) from private.${table};`, "42501");
        fails(
          `set role ${role};\ninsert into private.${table}(account_id) values(gen_random_uuid());`,
          "42501"
        );
      }
  });

  await check("choices start off and save for the caller only", () => {
    const a = formSignUp();
    const b = formSignUp();
    assert.deepEqual(choices(a), ALL_OFF);
    assert.deepEqual(save(a, { analytics: true }), { ...ALL_OFF, analytics: true });
    assert.deepEqual(choices(a), { ...ALL_OFF, analytics: true });
    assert.deepEqual(events(a), [["analytics", true, WORDING]]);
    // Another member is untouched and sees only their own.
    assert.deepEqual(choices(b), ALL_OFF);
    assert.deepEqual(events(b), []);
    // Repeating a save adds nothing; null leaves a choice as it is.
    assert.deepEqual(save(a, { analytics: true, marketing_email: null }), {
      ...ALL_OFF,
      analytics: true,
    });
    assert.equal(events(a).length, 1);
    // Several at once: only the changes are recorded, in one save.
    assert.deepEqual(save(a, { marketing_email: true, analytics: true, marketing_sms: false }), {
      ...ALL_OFF,
      analytics: true,
      marketing_email: true,
    });
    assert.deepEqual(events(a), [
      ["analytics", true, WORDING],
      ["marketing_email", true, WORDING],
    ]);
    // Withdrawing is one change too, and the latest row decides.
    assert.deepEqual(save(a, { marketing_email: false }, "communication-2027-01"), {
      ...ALL_OFF,
      analytics: true,
    });
    assert.deepEqual(events(a).at(-1), ["marketing_email", false, "communication-2027-01"]);
    assert.deepEqual(save(a, { third_party_sharing: true, analytics: false }), {
      ...ALL_OFF,
      third_party_sharing: true,
    });
    early.a = a;
    early.b = b;
  });
  await check("invalid saves are refused and record nothing", () => {
    const a = early.a;
    const count = events(a).length;
    fails(member(a, `select api.save_my_communication_choices('${WORDING}');`), "22023", /no choice/);
    for (const wording of ["", "Communication", "x".repeat(41), "a b", "-start"])
      fails(
        member(a, `select api.save_my_communication_choices(${literal(wording)},p_analytics=>true);`),
        "22023",
        /invalid wording version/
      );
    fails(
      member(a, `select api.save_my_communication_choices(null,p_analytics=>true);`),
      "22023",
      /invalid wording version/
    );
    assert.equal(events(a).length, count);
  });
  await check("at most 40 changes a day per account", () => {
    const user = formSignUp();
    for (let n = 0; n < 20; n++) {
      save(user, { analytics: true });
      save(user, { analytics: false });
    }
    assert.equal(events(user).length, 40);
    fails(
      member(user, `select api.save_my_communication_choices('${WORDING}',p_analytics=>true);`),
      "PT429",
      /too many changes/
    );
    // A save that changes nothing still answers.
    assert.deepEqual(save(user, { analytics: false }), ALL_OFF);
    // Two changes when one place is left: both refused, nothing recorded.
    q(`delete from private.communication_choice_events where id=(select id from private.communication_choice_events
        where account_id='${user.id}' order by recorded_at limit 1);`);
    fails(
      member(
        user,
        `select api.save_my_communication_choices('${WORDING}',p_analytics=>true,p_marketing_sms=>true);`
      ),
      "PT429"
    );
    assert.equal(events(user).length, 39);
    assert.deepEqual(save(user, { analytics: true }), { ...ALL_OFF, analytics: true });
  });
  await check("history rows never change", () => {
    fails(
      `update private.communication_choice_events set granted=not granted where account_id='${early.a.id}';`,
      "23514",
      /consent records are history/
    );
  });
  await check("only signed-in members with a live session", () => {
    const a = early.a;
    fails(anon(`select api.get_my_communication_choices();`), "42501");
    fails(anon(`select api.save_my_communication_choices('${WORDING}',p_analytics=>true);`), "42501");
    fails(anon(`select api.list_my_email_history(20);`), "42501");
    fails(service(`select api.get_my_communication_choices();`), "42501");
    fails(service(`select api.save_my_communication_choices('${WORDING}',p_analytics=>true);`), "42501");
    fails(service(`select api.list_my_email_history(20);`), "42501");
    // An ended session, an anonymous claim and an unconfirmed email are refused.
    const ended = { ...a, session: "00000000-0000-4000-8000-000000000000" };
    fails(member(ended, `select api.get_my_communication_choices();`), "42501", /live session/);
    fails(
      as({ ...claims(a), is_anonymous: true }, `select api.get_my_communication_choices();`),
      "42501"
    );
    const unconfirmed = formSignUp();
    q(`update auth.users set email_confirmed_at=null where id='${unconfirmed.id}';`);
    fails(
      member(unconfirmed, `select api.save_my_communication_choices('${WORDING}',p_analytics=>true);`),
      "42501"
    );
    assert.deepEqual(events(unconfirmed), []);
  });
  await check("email history: the caller's finished emails only, nothing identifying", () => {
    const { a, b } = early;
    const sent = queue(a, "payment_completed", { processed: true });
    const failed = queue(a, "post_expired", { attempts: 8 });
    queue(a, "trial_started", { attempts: 3 }); // still retrying: not shown
    queue(a, "identity_accepted", { attempts: 0 }); // not yet sent: not shown
    queue(b, "payment_completed", { processed: true });
    const items = history(a).items;
    assert.deepEqual(
      items.map((item) => [item.id, item.kind, item.status]).sort(),
      [
        [failed, "post_expired", "failed"],
        [sent, "payment_completed", "sent"],
      ].sort()
    );
    for (const item of items) assert.deepEqual(Object.keys(item).sort(), ["at", "id", "kind", "status"]);
    assert.equal(history(b).items.length, 1);
    assert.deepEqual(history(formSignUp()), { items: [] });
    assert.equal(history(a, 1).items.length, 1);
    for (const limit of [0, 51, "null"])
      fails(member(a, `select api.list_my_email_history(${limit});`), "22023", /invalid limit/);
    assert.deepEqual(json(member(a, `select api.list_my_email_history();`)), history(a));
  });
  await check("who may run each function, and how", () => {
    const nobody = { anon: false, authenticated: false, service_role: false };
    const members = { anon: false, authenticated: true, service_role: false };
    assert.deepEqual(grantsOf(FUNCTIONS), {
      "internal.guard_consent_record()": nobody,
      "internal.communication_choices_dto(uuid)": nobody,
      "internal.get_my_communication_choices()": members,
      "api.get_my_communication_choices()": members,
      "internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean)": members,
      "api.save_my_communication_choices(text,boolean,boolean,boolean,boolean)": members,
      "internal.list_my_email_history(integer)": members,
      "api.list_my_email_history(integer)": members,
      "internal.record_signup_terms()": nobody,
    });
    const meta = json(`select jsonb_object_agg(oid::regprocedure::text, jsonb_build_object('definer',prosecdef,
        'owner',proowner::regrole::text,'config',proconfig))
      from pg_proc where oid=any(array[${FUNCTIONS.map((f) => `'${f}'::regprocedure`).join(",")}]);`);
    for (const signature of FUNCTIONS) {
      const entry = Object.entries(meta).find(([key]) =>
        key.replaceAll(" ", "").startsWith(signature.replace(/\(.*/, "("))
      )?.[1];
      assert.ok(entry, signature);
      assert.equal(entry.owner, "postgres", signature);
      assert.deepEqual(entry.config, ["search_path=pg_catalog"], signature);
      assert.equal(
        entry.definer,
        signature.startsWith("internal.") &&
          !["internal.guard_consent_record()", "internal.communication_choices_dto(uuid)"].includes(
            signature
          ),
        signature
      );
    }
    assert.equal(
      q(
        `select count(*) from pg_trigger where tgname='record_signup_terms' and tgrelid='auth.users'::regclass;`
      ),
      "1"
    );
  });
  await check("preflight counts what was recorded", () => {
    const rows = preflight();
    assert.equal(rows.length, 1, JSON.stringify(rows));
    const counts = /choice changes recorded: (\d+); sign-up acceptances recorded: (\d+)$/.exec(
      rows[0][1]
    );
    assert.ok(counts, rows[0][1]);
    assert.equal(counts[1], q(`select count(*) from private.communication_choice_events;`));
    assert.equal(counts[2], q(`select count(*) from private.signup_terms_acceptances;`));
  });
  await check("apply, roll back and apply again are clean", () => {
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
    assert.deepEqual(choices(early.a), { ...ALL_OFF, third_party_sharing: true });
    applySteps(database, [{ label: "communication choices rollback", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before, "the rollback leaves the pre-update schema");
    for (const signature of FUNCTIONS) assert.equal(bodyOf(signature), "missing", signature);
    assert.match(preflight()[0][1], /: update not applied; current terms: /);
    // Sign-ups work without the trigger.
    formSignUp();
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    assert.deepEqual(choices(early.a), ALL_OFF);
    assert.equal(acceptance(formSignUp()).method, "email_form");
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep choices and sign-up Terms", () => {
      const user = formSignUp();
      assert.equal(acceptance(user).method, "email_form");
      assert.deepEqual(save(user, { marketing_sms: true }), { ...ALL_OFF, marketing_sms: true });
      assert.deepEqual(history(user), { items: [] });
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Communication choices checks passed: ${passed.length} in ${Math.round((Date.now() - begun) / 1000)} s.`
);
