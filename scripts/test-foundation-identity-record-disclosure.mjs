#!/usr/bin/env node
// Behaviour checks for 20261121043124_identity_record_disclosure.sql:
// authority requests. A governor or admin with a recent authenticator code
// (15 minutes) opens a member's kept identity record against a recorded
// request; the log row is written before anything is shown, a search that
// finds nobody is logged too, people are never looked up by name, a record
// closes after 15 minutes, and both logs are append-only. Then, with
// scripts/lib/foundation-authority-request-types.mjs, rule D9
// (20261122013616_authority_request_types.sql): only a subpoena, court order,
// search warrant or urgent life-risk request, each with its confirmation, and
// never the selfie for an urgent one.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members and staff call as `authenticated` with synthetic claims and a
// live session row; the website's server calls as `service_role`. The script
// runs the update's read-only preflight, checks its refusals, applies it,
// checks the rules, and proves apply -> rollback -> apply returns the same
// fingerprints. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-identity-record-disclosure.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Every
// person, name, number, fingerprint and encrypted ID number is synthetic; no
// object storage is involved.
import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertDriftRefused,
  assertReadOnlyPreflight,
  executeGrants,
  openUpdateCheck,
  sqlLiteral,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  D9_UPDATE,
  checkAuthorityRequestTypes,
  d9OpenSql,
  d9Request,
} from "./lib/foundation-authority-request-types.mjs";

const UPDATE = "20261121043124_identity_record_disclosure.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const STAFF_ACTOR = "internal.staff_actor(text)";
const APPEND_ONLY = "internal.append_only_guard()";
const OPEN = "api.open_identity_disclosure(text,text,text,text,text,boolean)";
const READ = "api.read_identity_disclosure(uuid,text,uuid)";
const LIST = "api.list_identity_disclosures()";
const MATERIAL = "api.identity_disclosure_material(uuid,uuid)";

const {
  started,
  database,
  check,
  current,
  passed: checks,
  q,
  json,
  run,
  fails,
  member,
  staff,
  service,
  fingerprint,
  bodyMd5,
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const fp = (label) =>
    `${createHash("sha256").update(`person-${label}-${randomUUID()}`).digest("base64url").slice(0, 42)}A`;
  const phoneNumber = () => `+2782${String(randomInt(1e7)).padStart(7, "0")}`;

  // Synthetic people, written as the database owner with triggers and foreign
  // keys off (as the other replayed-schema checks seed identity rows).
  syntheticMember("setup");
  q(`create or replace function vmtest.staff_member(p_label text,p_role text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      update auth.sessions set aal='aal2' where id=(m->>'session')::uuid;
      insert into auth.mfa_factors(user_id,factor_type,status) values((m->>'id')::uuid,'totp','verified');
      if p_role is not null then insert into private.staff_roles(user_id,role) values((m->>'id')::uuid,p_role); end if;
      return m;
    end$$;
    create or replace function vmtest.person(p_label text,p_fp text,p_phones text[],p_accepted boolean,
      p_reviewer uuid,p_slug text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); uid uuid:=(m->>'id')::uuid; c uuid:=gen_random_uuid();
      ida uuid:=gen_random_uuid(); sea uuid:=gen_random_uuid(); sub uuid:=gen_random_uuid();
      post uuid:=gen_random_uuid(); ph text; i integer:=0; begin
      perform set_config('session_replication_role','replica',true);
      insert into private.evidence_cases(id,subject_id,kind,status) values(c,uid,'kyc','decided');
      insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key,state,deleted_at,created_at)
        values(ida,c,uid,'id_front','evidence/'||c||'/'||ida,'deleted',now()-interval '1 day',now()-interval '40 days');
      insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key,state,sha256,size_bytes,created_at)
        values(sea,c,uid,'selfie','evidence/'||c||'/'||sea,'clean',repeat('ab',32),4321,now()-interval '40 days');
      insert into private.verification_identity_submissions(id,case_id,owner_id,case_version,id_artifact_id,
          selfie_artifact_id,identity_hmac,identity_key_id,number_ciphertext,number_iv,number_tag,encryption_key_id,
          receipt_id,recipe,risk_score,created_at)
        values(sub,c,uid,1,ida,sea,p_fp,'identity-match-v1',repeat('a1',13),repeat('b2',12),repeat('c3',16),
          'identity-number-v1',gen_random_uuid(),'manual-id-selfie-v1',10,now()-interval '40 days');
      insert into private.identity_submission_names(submission_id,owner_id,legal_first_name,legal_last_name)
        values(sub,uid,'Thando Sipho','Dlamini-'||p_label);
      if p_accepted then
        insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by,reviewed_at)
          values(uid,sub,p_fp,p_reviewer,now()-interval '39 days');
      end if;
      foreach ph in array p_phones loop
        i:=i+1;
        insert into private.verification_phone_proofs(owner_id,challenge_id,phone,verified_at,revoked_at)
          values(uid,gen_random_uuid(),ph,now()-make_interval(days=>100-i),
            case when i<cardinality(p_phones) then now()-make_interval(days=>99-i) end);
      end loop;
      insert into private.posts(id,owner_id,kind,area,category_key,status,title)
        values(post,uid,'listing','market','other','draft','Synthetic post');
      if p_slug is not null then insert into private.post_slugs(slug,post_id) values(p_slug,post); end if;
      perform set_config('session_replication_role','origin',true);
      return m||jsonb_build_object('post',post,'submission',sub,'selfie',sea,'case',c,
        'email',(select email from auth.users where id=uid));
    end$$;`);
  const staffMember = (label, role) =>
    json(`select vmtest.staff_member(${sqlLiteral(label)},${role ? sqlLiteral(role) : "null"});`);
  const reviewer = staffMember("reviewer", null);
  const person = (label, { accepted = true, phones = [phoneNumber()], slug = null } = {}) => {
    const fingerprintValue = fp(label);
    const made = json(
      `select vmtest.person(${sqlLiteral(label)},'${fingerprintValue}',array[${phones.map(sqlLiteral).join(",")}]::text[],${accepted},'${reviewer.id}',${slug ? sqlLiteral(slug) : "null"});`
    );
    return { ...made, fingerprint: fingerprintValue, phones };
  };
  const request = (overrides = {}) => ({
    type: "subpoena",
    reference: "CAS 123/11/2026",
    reason: "Fraud investigation into a reported listing; the subpoena names the account holder.",
    kind: "phone",
    value: "+27820000000",
    attested: true,
    ...overrides,
  });
  const openSql = (r) =>
    `select api.open_identity_disclosure(${[r.type, r.reference, r.reason, r.kind, r.value]
      .map((v) => (v === null ? "null" : sqlLiteral(v)))
      .join(",")},${r.attested === null ? "null" : r.attested});`;
  const totpMinutesAgo = (minutes) => Math.floor(Date.now() / 1000) - minutes * 60;
  const open = (who, r, totpAt) => json(staff(who, openSql(r), totpAt));
  const readSql = (id, purpose = "view", subject = null) =>
    `select api.read_identity_disclosure('${id}','${purpose}',${subject ? `'${subject}'` : "null"});`;
  const read = (who, id, purpose, subject) => json(staff(who, readSql(id, purpose, subject)));
  const logCount = () => Number(q(`select count(*) from private.identity_disclosures;`));
  const eventCount = () => Number(q(`select count(*) from private.identity_disclosure_events;`));
  const logRow = (id) =>
    json(`select to_jsonb(d) from private.identity_disclosures d where d.id='${id}';`);
  /** Moves a disclosure's clock back (owner only, append-only guard off). */
  const age = (id, interval) =>
    q(`begin; set local session_replication_role=replica;
      update private.identity_disclosures set opened_at=opened_at-interval '${interval}',
        closes_at=closes_at-interval '${interval}' where id='${id}'; commit;`);

  // ------------------------------------------------------------ before
  await check("before the update: reviewed bodies, no disclosure logs", () => {
    assert.equal(bodyMd5(STAFF_ACTOR), "269f0871f156f57c029cedcab72f6c3f");
    assert.equal(bodyMd5(APPEND_ONLY), "dfac5657b00f4d86a399e04e44d2ea59");
    assert.equal(q(`select to_regclass('private.identity_disclosures') is null;`), "t");
    assert.equal(
      q(`select count(*) from private.staff_capabilities where capability='identity:disclose';`),
      "0"
    );
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^identity record disclosure: update not applied; governors and admins: \d+$/
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () =>
    assertDriftRefused(
      { q, fails, fingerprint, preflightRows: preflight },
      {
        rollback: ROLLBACK,
        updateSql: step.sql,
        signatures: [STAFF_ACTOR, APPEND_ONLY],
        drift: /identity record disclosure drift/,
      }
    )
  );

  await check("an audit trail view that is not the reviewed one is refused", () => {
    const before = fingerprint();
    const view = q(`select pg_get_viewdef('private.frontend_staff_audit_events'::regclass);`);
    q(`create or replace view private.frontend_staff_audit_events with (security_invoker=true) as ${view.replace(/;\s*$/, "")}
      union all select 'x:'||gen_random_uuid()::text,now(),null::uuid,null::uuid,'account','x:y',null::text where false;`);
    const rows = preflight();
    assert.match(rows[0][1], /unexpected state/);
    assert.ok(
      rows.some((r) =>
        r[1].startsWith("private.frontend_staff_audit_events is not the reviewed view")
      ),
      JSON.stringify(rows)
    );
    assert.match(fails(step.sql, "55000"), /frontend_staff_audit_events is not the reviewed view/);
    q(
      `create or replace view private.frontend_staff_audit_events with (security_invoker=true) as ${view}`
    );
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "identity record disclosure",
    fingerprint,
    preflightRows: preflight,
    appliedSummary:
      /^identity record disclosure: already applied; governors and admins: \d+; disclosures: 0$/,
  });

  // The people and staff of the checks.
  const governor = staffMember("governor", "governor");
  const admin = staffMember("admin", "admin");
  const otherAdmin = staffMember("other-admin", "admin");
  const moderator = staffMember("moderator", "moderator");
  const plainMember = syntheticMember("plain-member");
  const [oldPhone, currentPhone] = [phoneNumber(), phoneNumber()];
  const thando = person("thando", {
    phones: [oldPhone, currentPhone],
    slug: `synthetic-post-${randomUUID().slice(0, 8)}`,
  });
  const tried = person("tried", { accepted: false });

  await check(
    "the capability: governors and admins, recent second factor; moderators never",
    () => {
      assert.equal(
        q(`select string_agg(role||':'||requires_recent_mfa,',' order by role) from private.staff_capabilities
        where capability='identity:disclose';`),
        "admin:true,governor:true"
      );
    }
  );
  await check("grants: staff commands for authenticated, the material for the server only", () => {
    assert.deepEqual(executeGrants(json, [OPEN, READ, LIST, MATERIAL]), {
      [OPEN]: { anon: false, authenticated: true, service_role: false },
      [READ]: { anon: false, authenticated: true, service_role: false },
      [LIST]: { anon: false, authenticated: true, service_role: false },
      [MATERIAL]: { anon: false, authenticated: false, service_role: true },
    });
    // Internal helpers taking an explicit staff member are never callable by
    // a browser role; the logs have no table grants and row level security.
    assert.deepEqual(
      executeGrants(json, [
        "internal.identity_disclosure_material(uuid,uuid)",
        "internal.identity_disclosure_open_for(uuid,uuid)",
        "internal.identity_disclosure_record(private.identity_disclosures,uuid)",
      ]),
      {
        "internal.identity_disclosure_material(uuid,uuid)": {
          anon: false,
          authenticated: false,
          service_role: true,
        },
        "internal.identity_disclosure_open_for(uuid,uuid)": {
          anon: false,
          authenticated: false,
          service_role: false,
        },
        "internal.identity_disclosure_record(private.identity_disclosures,uuid)": {
          anon: false,
          authenticated: false,
          service_role: false,
        },
      }
    );
    for (const table of ["identity_disclosures", "identity_disclosure_events"]) {
      assert.equal(
        q(`select bool_or(has_table_privilege(r,'private.${table}','select,insert,update,delete'))
          from unnest(array['anon','authenticated','service_role']) r;`),
        "f"
      );
      assert.equal(
        q(`select relrowsecurity from pg_class where oid='private.${table}'::regclass;`),
        "t"
      );
    }
    for (const fn of [OPEN, READ, LIST, MATERIAL])
      assert.equal(
        q(
          `select prosecdef::text||':'||array_to_string(proconfig,',') from pg_proc where oid='${fn}'::regprocedure;`
        ),
        "false:search_path=pg_catalog"
      );
  });

  const thandoRequest = request({ value: currentPhone });
  await check("who may open: only a governor or admin with a code from the last 15 minutes", () => {
    const before = logCount();
    fails(`set role anon;\n${openSql(thandoRequest)}`, "42501", /permission denied for function/);
    fails(service(openSql(thandoRequest)), "42501", /permission denied for function/);
    fails(
      member(plainMember, openSql(thandoRequest)),
      "42501",
      /staff session with second factor required/
    );
    fails(staff(moderator, openSql(thandoRequest)), "42501", /capability not granted/);
    fails(
      staff(admin, openSql(thandoRequest), totpMinutesAgo(20)),
      "42501",
      /recent second-factor verification required/
    );
    fails(
      staff(governor, openSql(thandoRequest), totpMinutesAgo(16)),
      "42501",
      /recent second-factor verification required/
    );
    assert.equal(logCount(), before, "a refused opening logs nothing and shows nothing");
    const byGovernor = open(governor, thandoRequest);
    const byAdmin = open(admin, thandoRequest, totpMinutesAgo(14));
    assert.equal(byGovernor.outcome, "record");
    assert.equal(byAdmin.outcome, "record");
    assert.equal(logCount(), before + 2);
  });
  await check("who may read, list and fetch material: the same rule", () => {
    const opened = open(admin, thandoRequest);
    for (const sql of [readSql(opened.disclosure_id), `select api.list_identity_disclosures();`]) {
      fails(`set role anon;\n${sql}`, "42501", /permission denied for function/);
      fails(member(plainMember, sql), "42501", /staff session with second factor required/);
      fails(staff(moderator, sql), "42501", /capability not granted/);
      fails(
        staff(admin, sql, totpMinutesAgo(20)),
        "42501",
        /recent second-factor verification required/
      );
    }
    const material = `select api.identity_disclosure_material('${opened.disclosure_id}','${admin.id}');`;
    fails(staff(admin, material), "42501", /permission denied for function/);
    fails(`set role anon;\n${material}`, "42501", /permission denied for function/);
    assert.ok(json(staff(governor, `select api.list_identity_disclosures();`)).items.length >= 1);
  });

  await check("a request needs its type, reference, reason and the confirmation", () => {
    const before = logCount();
    const refused = [
      [{ type: "letter" }, "disclosure_request_type_invalid"],
      [{ type: null }, "disclosure_request_type_invalid"],
      [{ reference: "  " }, "disclosure_reference_required"],
      [{ reference: "x".repeat(101) }, "disclosure_reference_required"],
      [{ reason: "short" }, "disclosure_reason_required"],
      [{ attested: false }, "disclosure_attestation_required"],
      [{ attested: null }, "disclosure_attestation_required"],
    ];
    for (const [change, reason] of refused) {
      const stderr = fails(staff(admin, openSql(request(change))), "22023");
      assert.match(stderr, new RegExp(`DETAIL:\\s+${reason}`), stderr);
      assert.ok(!stderr.includes("Thando") && !stderr.includes("+2782"), stderr);
    }
    assert.equal(logCount(), before, "nothing is logged for an incomplete request");
  });
  await check("never by name: only post, ID number, phone or email, each in its own form", () => {
    const before = logCount();
    for (const kind of ["name", "full_name", "surname", "legal_name", ""]) {
      const stderr = fails(
        staff(admin, openSql(request({ kind, value: "Thando Dlamini" }))),
        "22023"
      );
      assert.match(stderr, /DETAIL:\s+disclosure_lookup_invalid/);
    }
    for (const kind of ["post", "id_number", "phone", "email"]) {
      for (const value of ["Thando Dlamini", "Dlamini", "Thando Sipho Dlamini-thando"]) {
        const stderr = fails(staff(admin, openSql(request({ kind, value }))), "22023");
        assert.match(stderr, /DETAIL:\s+disclosure_lookup_value_invalid/, `${kind}: ${stderr}`);
        assert.ok(!stderr.includes(value), stderr);
      }
    }
    // A raw 13-digit ID number is refused: the server sends its fingerprint.
    fails(staff(admin, openSql(request({ kind: "id_number", value: "8001015009087" }))), "22023");
    assert.equal(logCount(), before);
  });

  let shown;
  await check(
    "log before show: opening answers only the log row, and the row is there first",
    () => {
      const before = logCount();
      const opened = open(admin, thandoRequest);
      assert.deepEqual(Object.keys(opened).sort(), [
        "closes_at",
        "disclosure_id",
        "match_count",
        "number",
        "outcome",
      ]);
      const answer = JSON.stringify(opened);
      for (const secret of ["Dlamini", "Thando", currentPhone, thando.fingerprint, thando.id])
        assert.ok(!answer.includes(secret), `the opening shows ${secret}`);
      assert.equal(logCount(), before + 1);
      const row = logRow(opened.disclosure_id);
      assert.equal(row.opened_by, admin.id);
      assert.equal(row.request_type, "subpoena");
      assert.equal(row.request_reference, "CAS 123/11/2026");
      assert.equal(row.lookup_kind, "phone");
      assert.equal(row.lookup_value, currentPhone);
      assert.equal(row.attested, true);
      assert.deepEqual(row.subject_ids, [thando.id]);
      assert.equal(
        q(
          `select closes_at-opened_at='15 minutes'::interval from private.identity_disclosures where id='${opened.disclosure_id}';`
        ),
        "t"
      );
      // Reading logs the look before it answers.
      const events = eventCount();
      shown = read(admin, opened.disclosure_id);
      assert.equal(eventCount(), events + 1);
      assert.equal(
        q(
          `select kind||':'||staff_id from private.identity_disclosure_events where disclosure_id='${opened.disclosure_id}';`
        ),
        `viewed:${admin.id}`
      );
      shown.id = opened.disclosure_id;
    }
  );
  await check("log before show: when the log cannot be written, nothing is shown", () => {
    const opened = open(admin, thandoRequest);
    const blocked = (table, sql) =>
      run(`begin;
        create function vmtest.refuse_log() returns trigger language plpgsql as $f$ begin raise exception 'log refused'; end $f$;
        create trigger refuse_log before insert on private.${table} for each row execute function vmtest.refuse_log();
        ${sql}
        rollback;`);
    const readBlocked = blocked(
      "identity_disclosure_events",
      staff(admin, readSql(opened.disclosure_id))
    );
    assert.match(readBlocked.stderr, /log refused/);
    assert.ok(!readBlocked.stdout.includes("Dlamini"), readBlocked.stdout);
    const openBlocked = blocked("identity_disclosures", staff(admin, openSql(thandoRequest)));
    assert.match(openBlocked.stderr, /log refused/);
    assert.ok(!openBlocked.stdout.includes("disclosure_id"), openBlocked.stdout);
  });
  await check(
    "the record: full names, ID number and selfie kept, ID photo deleted, every phone",
    () => {
      assert.equal(shown.records.length, 1);
      const [record] = shown.records;
      assert.equal(record.account_id, thando.id);
      assert.equal(record.kept, true);
      assert.equal(record.legal_first_name, "Thando Sipho");
      assert.equal(record.legal_last_name, "Dlamini-thando");
      assert.equal(record.checked_by, "staff_review");
      assert.equal(record.id_number_kept, true);
      assert.equal(record.selfie.kept, true);
      assert.equal(record.id_photo.kept, false);
      assert.ok(record.id_photo.deleted_at);
      assert.deepEqual(
        record.phones.map((p) => [p.phone, p.revoked_at === null]),
        [
          [currentPhone, true],
          [oldPhone, false],
        ]
      );
      assert.equal(shown.disclosure.lookup_value, currentPhone);
      assert.equal(shown.disclosure.reference, "CAS 123/11/2026");
      // Never the stored object or the encrypted number.
      const text = JSON.stringify(shown);
      assert.ok(!text.includes("evidence/"), text);
      assert.ok(!text.includes("a1a1a1"), text);
      assert.ok(!text.includes(thando.fingerprint), text);
    }
  );
  await check(
    "the website's server gets the encrypted number and the selfie object, only for the opener",
    () => {
      const material = json(
        service(`select api.identity_disclosure_material('${shown.id}','${admin.id}');`)
      );
      assert.equal(material.records.length, 1);
      assert.equal(material.records[0].account_id, thando.id);
      assert.deepEqual(material.records[0].encrypted_number, {
        ciphertext: "a1".repeat(13),
        iv: "b2".repeat(12),
        tag: "c3".repeat(16),
        key_id: "identity-number-v1",
      });
      assert.equal(material.records[0].selfie.artifact_id, thando.selfie);
      assert.equal(
        material.records[0].selfie.object_key,
        `evidence/${thando.case}/${thando.selfie}`
      );
      const stderr = fails(
        service(`select api.identity_disclosure_material('${shown.id}','${otherAdmin.id}');`),
        "PT409"
      );
      assert.match(stderr, /DETAIL:\s+disclosure_unavailable/);
      // The selfie look is logged per person, for a person the disclosure names.
      const selfie = read(admin, shown.id, "selfie", thando.id);
      assert.equal(selfie.records.length, 1);
      assert.equal(
        q(
          `select count(*) from private.identity_disclosure_events where disclosure_id='${shown.id}' and kind='selfie_viewed' and subject_id='${thando.id}';`
        ),
        "1"
      );
      assert.match(
        fails(staff(admin, readSql(shown.id, "selfie", tried.id)), "22023"),
        /disclosure_subject_invalid/
      );
      assert.match(
        fails(staff(admin, readSql(shown.id, "selfie")), "22023"),
        /disclosure_subject_invalid/
      );
      assert.match(
        fails(staff(admin, readSql(shown.id, "download")), "22023"),
        /disclosure_purpose_invalid/
      );
    }
  );
  await check(
    "every way of finding a person: post id and link, ID number, phone (old ones too), email",
    () => {
      const ways = [
        { kind: "post", value: thando.post },
        {
          kind: "post",
          value: q(`select slug from private.post_slugs where post_id='${thando.post}';`),
        },
        { kind: "id_number", value: thando.fingerprint },
        { kind: "phone", value: oldPhone },
        { kind: "email", value: thando.email.toUpperCase() },
      ];
      for (const way of ways) {
        const opened = open(governor, request(way));
        assert.equal(opened.outcome, "record", JSON.stringify(way));
        const result = read(governor, opened.disclosure_id);
        assert.deepEqual(
          result.records.map((r) => r.account_id),
          [thando.id]
        );
        // The ID number search shows no fingerprint back.
        if (way.kind === "id_number") assert.equal(result.disclosure.lookup_value, null);
      }
    }
  );
  await check("no match is logged too, and shows nobody", () => {
    const before = logCount();
    const opened = open(admin, request({ value: "+27829999999" }));
    assert.equal(opened.outcome, "no_match");
    assert.equal(opened.match_count, 0);
    assert.equal(logCount(), before + 1);
    assert.deepEqual(logRow(opened.disclosure_id).subject_ids, []);
    assert.deepEqual(read(admin, opened.disclosure_id).records, []);
    const unknownPost = open(admin, request({ kind: "post", value: randomUUID() }));
    assert.equal(unknownPost.outcome, "no_match");
  });
  await check(
    "an ID number that was only tried confirms the account and dates, nothing more",
    () => {
      const opened = open(admin, request({ kind: "id_number", value: tried.fingerprint }));
      assert.equal(opened.outcome, "attempt_only");
      const result = read(admin, opened.disclosure_id);
      assert.equal(result.records.length, 1);
      assert.deepEqual(Object.keys(result.records[0]).sort(), ["account_id", "attempts", "kept"]);
      assert.equal(result.records[0].account_id, tried.id);
      assert.equal(result.records[0].kept, false);
      assert.equal(result.records[0].attempts.length, 1);
      assert.ok(!JSON.stringify(result).includes("Dlamini"));
      const material = json(
        service(`select api.identity_disclosure_material('${opened.disclosure_id}','${admin.id}');`)
      );
      assert.deepEqual(material.records, []);
      // The same account found by phone has no kept record.
      const byPhone = open(admin, request({ value: tried.phones[0] }));
      assert.equal(byPhone.outcome, "no_record");
      const shownByPhone = read(admin, byPhone.disclosure_id);
      assert.deepEqual(Object.keys(shownByPhone.records[0]).sort(), [
        "account_closed_at",
        "account_id",
        "kept",
      ]);
    }
  );
  await check("only the opener can read it", () => {
    const opened = open(admin, thandoRequest);
    const sql = readSql(opened.disclosure_id);
    assert.match(fails(staff(otherAdmin, sql), "PT409"), /DETAIL:\s+disclosure_unavailable/);
    assert.match(fails(staff(governor, sql), "PT409"), /DETAIL:\s+disclosure_unavailable/);
    assert.match(
      fails(staff(admin, readSql(randomUUID())), "PT409"),
      /DETAIL:\s+disclosure_unavailable/
    );
    assert.ok(read(admin, opened.disclosure_id).records.length === 1);
  });
  await check("a record closes 15 minutes after it was opened", () => {
    const opened = open(admin, thandoRequest);
    age(opened.disclosure_id, "14 minutes 50 seconds");
    assert.equal(read(admin, opened.disclosure_id).records.length, 1);
    age(opened.disclosure_id, "15 seconds");
    assert.match(
      fails(staff(admin, readSql(opened.disclosure_id)), "PT409"),
      /DETAIL:\s+disclosure_closed/
    );
    assert.match(
      fails(
        service(
          `select api.identity_disclosure_material('${opened.disclosure_id}','${admin.id}');`
        ),
        "PT409"
      ),
      /DETAIL:\s+disclosure_closed/
    );
  });
  await check("the list shows requests, never the person or the search value", () => {
    const { items } = json(staff(governor, `select api.list_identity_disclosures();`));
    assert.ok(items.length > 5 && items.length <= 50);
    const text = JSON.stringify(items);
    for (const secret of [
      "Dlamini",
      currentPhone,
      oldPhone,
      thando.email,
      thando.id,
      thando.fingerprint,
    ])
      assert.ok(!text.includes(secret), `the list shows ${secret}`);
    assert.deepEqual(Object.keys(items[0]).sort(), [
      "id",
      "number",
      "opened_at",
      "opened_by_name",
      "outcome",
      "printed",
      "reference",
      "request_type",
      "viewed",
    ]);
    assert.ok(items.some((item) => item.outcome === "no_match"));
  });
  await check(
    "the staff audit trail lists openings and looks, without the person's details",
    () => {
      // Every row of the trail (as the owner), then the staff page's own shape.
      const rows =
        json(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'action',replace(action,':','_'),
        'target_type',target_type,'reason',reason)),'[]') from private.frontend_staff_audit_events
      where action like 'identity:%';`);
      const page = json(
        staff(
          admin,
          `select api.get_frontend_staff_audit_page('{"action":"identity_disclosure"}'::jsonb);`
        )
      );
      assert.equal(page.total, rows.length);
      assert.equal(page.items.length, Math.min(50, rows.length));
      page.items = [...page.items, ...rows];
      const actions = new Set(rows.map((item) => item.action));
      for (const action of [
        "identity_disclosure_record",
        "identity_disclosure_no_match",
        "identity_disclosure_viewed",
        "identity_disclosure_selfie_viewed",
      ])
        assert.ok(actions.has(action), `${action} in ${[...actions]}`);
      for (const item of page.items) {
        assert.equal(item.target_type, "account");
        assert.match(item.id, /^[a-z_]+:[a-zA-Z0-9-]{1,40}$/);
        assert.match(item.reason, /^D-\d{4,}/);
      }
      const text = JSON.stringify(page.items);
      for (const secret of ["Dlamini", currentPhone, oldPhone, thando.email, thando.fingerprint])
        assert.ok(!text.includes(secret), `the audit trail shows ${secret}`);
    }
  );
  await check("both logs are append-only; only the retention setting may delete", () => {
    for (const table of ["identity_disclosures", "identity_disclosure_events"]) {
      fails(`update private.${table} set id=id;`, "23514", /is append-only/);
      fails(`delete from private.${table};`, "23514", /is append-only/);
      fails(`truncate private.${table} cascade;`, "23514", /is append-only/);
    }
    const before = logCount();
    const opened = open(governor, request({ value: "+27828888888" }));
    q(`begin; select set_config('vm.retention','on',true);
      delete from private.identity_disclosures where id='${opened.disclosure_id}'; commit;`);
    assert.equal(logCount(), before);
  });
  await check("a rollback is refused while the disclosure log holds a row", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /the disclosure log is not empty/);
    assert.equal(fingerprint(), before);
  });
  await check(
    "a staff member who loses the role can no longer read an open record or get its material",
    () => {
      const leaving = staffMember("leaving", "admin");
      const opened = open(leaving, thandoRequest);
      q(
        `update private.staff_roles set revoked_at=now(),revoked_by='${admin.id}' where user_id='${leaving.id}' and revoked_at is null;`
      );
      fails(staff(leaving, readSql(opened.disclosure_id)), "42501", /capability not granted/);
      assert.match(
        fails(
          service(
            `select api.identity_disclosure_material('${opened.disclosure_id}','${leaving.id}');`
          ),
          "PT409"
        ),
        /DETAIL:\s+disclosure_unavailable/
      );
    }
  );

  // Records opened under the first rule, read again after rule D9.
  const earlier = ["subpoena", "warrant", "police_case"].map((type) => ({
    id: open(admin, request({ type, value: currentPhone })).disclosure_id,
    type,
  }));
  const later = steps.slice(index + 1);
  const d9 = later.findIndex((s) => s.label === D9_UPDATE);
  assert.ok(d9 >= 0, `${D9_UPDATE} is missing`);
  applySteps(database, later.slice(0, d9));
  await check("later updates keep authority requests working", () => {
    for (const { id } of earlier) assert.equal(read(admin, id).records.length, 1);
  });
  await checkAuthorityRequestTypes(
    {
      check,
      q,
      json,
      fails,
      staff,
      service,
      fingerprint,
      admin,
      governor,
      moderator,
      thando,
      logCount,
      eventCount,
      openSql,
      request,
      readSql,
      read,
    },
    { database, current, step: later[d9], earlier }
  );
  if (later.length > d9 + 1) {
    applySteps(database, later.slice(d9 + 1));
    await check("updates after rule D9 keep authority requests working", () => {
      const opened = json(staff(admin, d9OpenSql(d9Request({ value: currentPhone }))));
      assert.equal(read(admin, opened.disclosure_id).records.length, 1);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Identity record disclosure checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
