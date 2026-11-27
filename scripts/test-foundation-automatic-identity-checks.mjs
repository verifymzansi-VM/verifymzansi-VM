#!/usr/bin/env node
// Behaviour checks for 20261121094003_automatic_identity_checks.sql: automatic
// ID checks by the independent verification partner, the admin setting
// (manual, staff_final, automatic), the spending guard, declines with "ask a
// person to look again" (5 days), the names tie between the website's
// comparison and the lock, real staff decisions on automatic results, and the
// deletion of the partner's copy.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members and staff call as `authenticated` with synthetic claims and a
// live session row; the website's server calls as `service_role`. The script
// runs the update's read-only preflight, checks its refusals, applies it,
// checks the rules, and proves apply -> rollback -> apply returns the same
// fingerprints. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-automatic-identity-checks.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Every
// person, name, fingerprint, encrypted ID number, session and file receipt is
// synthetic; no object storage and no partner is involved.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertDriftRefused,
  assertReadOnlyPreflight,
  executeGrants,
  openUpdateCheck,
  sqlJsonb,
  sqlLiteral,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261121094003_automatic_identity_checks.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const RELIED_ON = [
  "internal.staff_actor(text)",
  "internal.price_draft_actor()",
  "internal.append_only_guard()",
  "internal.open_verification_case()",
  "internal.complete_evidence_upload(uuid,text,text,integer)",
  "internal.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer)",
  "internal.staff_evidence_metadata(uuid,text,uuid,text)",
];
const MEMBER_COMMANDS = [
  "api.get_identity_check_availability()",
  "api.start_my_identity_check()",
  "api.ask_person_identity_check(uuid,text)",
];
const STAFF_COMMANDS = [
  "api.get_identity_check_settings()",
  "api.set_identity_check_mode(text,text)",
  "api.get_identity_check_for_case(uuid)",
];
const SERVICE_COMMANDS = [
  "api.attach_identity_check_session(uuid,uuid,text,text,text)",
  "api.report_identity_check_unavailable(uuid,text)",
  "api.begin_identity_check_evidence(uuid,uuid)",
  "api.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer)",
  "api.claim_identity_check_deletions(integer)",
  "api.mark_identity_check_provider_deleted(uuid)",
];
const HELPERS = [
  "internal.identity_check_route(uuid)",
  "internal.identity_check_askable(private.identity_checks)",
  "internal.identity_check_summary(private.identity_checks)",
  "internal.accept_automatic_identity_submission(uuid,uuid)",
  "internal.decline_automatic_identity_submission(uuid,uuid)",
  "internal.identity_check_with_person(private.identity_checks)",
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
  service,
  fingerprint,
  bodyMd5,
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const hex = (bytes) => randomBytes(bytes).toString("hex");
  const fp = () =>
    `${createHash("sha256").update(`person-${randomUUID()}`).digest("base64url").slice(0, 42)}A`;
  const encrypted = () => ({
    ciphertext: hex(13),
    iv: hex(12),
    tag: hex(16),
    key_id: "identity-number-v1",
  });
  const receipt = () => ({ stored_sha256: hex(32), content_sha256: hex(32), size: 123456 });
  const totpMinutesAgo = (minutes) => Math.floor(Date.now() / 1000) - minutes * 60;

  syntheticMember("setup");
  q(`create or replace function vmtest.staff_member(p_label text,p_role text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      update auth.sessions set aal='aal2' where id=(m->>'session')::uuid;
      insert into auth.mfa_factors(user_id,factor_type,status) values((m->>'id')::uuid,'totp','verified');
      if p_role is not null then insert into private.staff_roles(user_id,role) values((m->>'id')::uuid,p_role); end if;
      return m;
    end$$;
    create or replace function vmtest.named_member(p_label text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      perform set_config('session_replication_role','replica',true);
      insert into private.profiles(account_id) values((m->>'id')::uuid) on conflict(account_id) do nothing;
      update private.profiles set legal_first_name='Thando Sipho',legal_last_name='Dlamini' where account_id=(m->>'id')::uuid;
      insert into private.verification_phone_proofs(owner_id,challenge_id,phone)
        values((m->>'id')::uuid,gen_random_uuid(),'+2783'||lpad(nextval('vmtest.phone_seq')::text,7,'0'));
      perform set_config('session_replication_role','origin',true);
      return m;
    end$$;`);
  const staffMember = (label, role) =>
    json(`select vmtest.staff_member(${sqlLiteral(label)},${role ? sqlLiteral(role) : "null"});`);
  const namedMember = (label) => json(`select vmtest.named_member(${sqlLiteral(label)});`);

  // ------------------------------------------------------------ before
  await check("before the update: reviewed bodies, no automatic checks", () => {
    for (const sig of RELIED_ON) assert.notEqual(bodyMd5(sig), "missing", sig);
    assert.equal(q(`select to_regclass('private.identity_checks') is null;`), "t");
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], /^automatic identity checks: update not applied; admins: \d+$/);
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () =>
    assertDriftRefused(
      { q, fails, fingerprint, preflightRows: preflight },
      {
        rollback: ROLLBACK,
        updateSql: step.sql,
        signatures: RELIED_ON,
        drift: /automatic identity checks drift/,
      }
    )
  );

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "automatic identity checks",
    fingerprint,
    preflightRows: preflight,
    appliedSummary:
      /^automatic identity checks: already applied; admins: \d+; mode: manual; checks: 0$/,
  });

  const admin = staffMember("admin", "admin");
  const moderator = staffMember("moderator", "moderator");
  const governor = staffMember("governor", "governor");

  const availability = (who) => json(member(who, "select api.get_identity_check_availability();"));
  const start = (who) => json(member(who, "select api.start_my_identity_check();"));
  const setModeApi = (mode, reason = "Owner decision for automatic ID checks.") =>
    json(staff(admin, `select api.set_identity_check_mode('${mode}',${sqlLiteral(reason)});`));
  // Until the retention update, the command accepts only manual; the checks
  // of the other settings set the row as the database owner.
  const setMode = (mode) => q(`update private.identity_check_settings set mode='${mode}';`);
  const checkRow = (id) =>
    json(`select to_jsonb(k) from private.identity_checks k where k.id='${id}';`);
  // A keyed hash of the member's network, as the website computes it.
  const NET = createHash("sha256").update("synthetic network").digest("hex");
  const attachSql = (
    check,
    session,
    url = `https://verify.didit.me/session/${session}`,
    hash = NET,
    kind = "phone"
  ) =>
    `select api.attach_identity_check_session('${check}','${session}',${sqlLiteral(url)},${hash === null ? "null" : sqlLiteral(hash)},${kind === null ? "null" : sqlLiteral(kind)});`;
  /** Starts a check for `who` and binds a synthetic partner session. */
  const startWithSession = (who) => {
    const started = start(who);
    const session = randomUUID();
    json(service(attachSql(started.check_id, session)));
    return { check: started.check_id, session };
  };
  const TYPED = { first_name: "Thando Sipho", last_name: "Dlamini" };
  const completeSql = (
    c,
    outcome,
    { reasons = [], risk = 10, fingerprint: f = fp(), names = TYPED } = {}
  ) =>
    outcome === "not_finished"
      ? `select api.complete_identity_check('${c.check}','${c.session}','not_finished',array[${reasons.map(sqlLiteral).join(",")}]::text[]);`
      : `select api.complete_identity_check('${c.check}','${c.session}','${outcome}',array[${reasons.map(sqlLiteral).join(",")}]::text[],
        ${sqlJsonb(receipt())},${sqlJsonb(receipt())},${sqlJsonb({ fingerprint: f, encrypted_number: encrypted() })},${sqlJsonb(names)},${risk});`;
  /** Reserves the evidence files and records the result as the server would. */
  const finish = (c, outcome, options) => {
    if (outcome !== "not_finished")
      json(service(`select api.begin_identity_check_evidence('${c.check}','${c.session}');`));
    return json(service(completeSql(c, outcome, options)));
  };
  const queueCases = () =>
    json(
      staff(
        moderator,
        "select coalesce(jsonb_agg(g->>'case_id'),'[]'::jsonb) from jsonb_array_elements((api.get_frontend_staff_verification_queue(100,'{}'))->'groups') g;"
      )
    );
  /** A staff claim on a case (claim_generation, claim_nonce, version). */
  const claim = (who, caseId) => json(staff(who, `select api.claim_evidence_case('${caseId}');`));
  /** Moves a check's clock back (owner only). */
  const age = (id, interval) =>
    q(`update private.identity_checks set created_at=created_at-interval '${interval}',
      expires_at=expires_at-interval '${interval}',
      declined_at=declined_at-interval '${interval}',finished_at=finished_at-interval '${interval}'
      where id='${id}';`);

  await check("the capability: admins only, recent second factor", () => {
    assert.equal(
      q(`select string_agg(role||':'||requires_recent_mfa,',' order by role) from private.staff_capabilities
        where capability='identity_check:configure';`),
      "admin:true"
    );
  });
  await check("grants: member, staff and server commands; helpers for nobody", () => {
    const expected = {};
    for (const sig of [...MEMBER_COMMANDS, ...STAFF_COMMANDS])
      expected[sig] = { anon: false, authenticated: true, service_role: false };
    for (const sig of SERVICE_COMMANDS)
      expected[sig] = { anon: false, authenticated: false, service_role: true };
    assert.deepEqual(
      executeGrants(json, [...MEMBER_COMMANDS, ...STAFF_COMMANDS, ...SERVICE_COMMANDS]),
      expected
    );
    for (const [sig, grants] of Object.entries(executeGrants(json, HELPERS)))
      assert.deepEqual(grants, { anon: false, authenticated: false, service_role: false }, sig);
    assert.equal(
      q(`select count(*) from information_schema.role_table_grants where table_schema='private'
        and grantee in ('PUBLIC','anon','authenticated','service_role') and table_name in ('identity_checks','identity_check_settings','identity_check_mode_events');`),
      "0"
    );
  });

  // ------------------------------------------------------------ manual
  await check("manual (the starting value): manual route, no check can start", () => {
    const m = namedMember("manual");
    assert.deepEqual(availability(m), { route: "manual", reason: "mode", check: null });
    assert.match(
      fails(member(m, "select api.start_my_identity_check();"), "PT409"),
      /identity_check_mode/
    );
    assert.equal(q(`select count(*) from private.identity_checks;`), "0");
  });

  // ------------------------------------------------------------ setting
  await check("the setting: admin with a recent second factor and a reason; logged", () => {
    assert.match(
      fails(
        staff(moderator, "select api.set_identity_check_mode('automatic','Moderators may not.');"),
        "42501"
      ),
      /capability|staff/
    );
    assert.match(
      fails(
        staff(governor, "select api.set_identity_check_mode('automatic','Governors may not.');"),
        "42501"
      ),
      /capability|staff/
    );
    fails(
      staff(
        admin,
        "select api.set_identity_check_mode('automatic','A stale code.');",
        totpMinutesAgo(20)
      ),
      "42501"
    );
    fails(staff(admin, "select api.set_identity_check_mode('automatic','abc');"), "22023");
    fails(
      staff(admin, "select api.set_identity_check_mode('sometimes','Not a mode at all.');"),
      "22023"
    );
    fails(
      staff(
        admin,
        `select api.set_identity_check_mode('manual',${sqlLiteral("Bidi \u202e trick")});`
      ),
      "22023"
    );
    fails(staff(admin, "select api.set_identity_check_mode('manual',E'Line\\none');"), "22023");
    // The database keeps the setting manual until the retention update.
    for (const mode of ["staff_final", "automatic"])
      assert.match(
        fails(
          staff(
            admin,
            `select api.set_identity_check_mode('${mode}','Owner decision for automatic ID checks.');`
          ),
          "PT409"
        ),
        /identity_check_retention_pending/
      );
    assert.deepEqual(setModeApi("manual"), { mode: "manual", changed: false, resumed: false });
    setMode("staff_final");
    assert.deepEqual(setModeApi("manual", "Back to staff review."), {
      mode: "manual",
      changed: true,
      resumed: false,
    });
    assert.equal(
      q(`select string_agg(from_mode||'>'||to_mode,',') from private.identity_check_mode_events;`),
      "staff_final>manual"
    );
    const settings = json(staff(moderator, "select api.get_identity_check_settings();"));
    assert.equal(settings.mode, "manual");
    assert.equal(settings.recent_changes.length, 1);
    assert.equal(settings.recent_changes[0].changed_by, admin.id);
    setMode("staff_final");
    const plain = namedMember("plain");
    fails(member(plain, "select api.get_identity_check_settings();"), "42501");
    fails("update private.identity_check_mode_events set reason='Changed later on.';", "23514");
  });

  // ------------------------------------------------------- staff_final
  await check("staff_final: a clean pass verifies at once, decided by the check", () => {
    const m = namedMember("clean");
    assert.deepEqual(availability(m), { route: "automatic", reason: null, check: null });
    const c = startWithSession(m);
    assert.deepEqual(start(m), {
      check_id: c.check,
      session_id: c.session,
      session_url: `https://verify.didit.me/session/${c.session}`,
      created: false,
    });
    const result = finish(c, "approved");
    assert.equal(result.status, "approved");
    const fact = json(
      `select to_jsonb(f) from private.accepted_identity_facts f where f.owner_id='${m.id}';`
    );
    assert.equal(fact.reviewed_by, null);
    assert.equal(fact.automatic_check_id, c.check);
    assert.equal(fact.revoked_at, null);
    assert.equal(
      q(
        `select legal_name_locked_at is not null and display_name='Thando Sipho Dlamini' from private.profiles where account_id='${m.id}';`
      ),
      "t"
    );
    assert.equal(
      q(
        `select status from private.evidence_cases where id=(select case_id from private.identity_checks where id='${c.check}');`
      ),
      "decided"
    );
    assert.equal(
      q(
        `select count(*) from private.outbox_events where kind='identity_accepted' and owner_id='${m.id}';`
      ),
      "1"
    );
    // The result is recorded once.
    assert.equal(json(service(completeSql(c, "declined"))).reused, true);
    assert.match(fails(member(m, "select api.start_my_identity_check();"), "PT409"), /accepted/);
  });
  await check("an automatic fact never names a reviewer and a staff fact always does", () => {
    const sub = q(
      `select submission_id from private.accepted_identity_facts where automatic_check_id is not null limit 1;`
    );
    fails(
      `update private.accepted_identity_facts set reviewed_by='${admin.id}' where submission_id='${sub}';`,
      "23514"
    );
  });
  await check("staff_final: anything else goes to the staff queue with its reasons", () => {
    const m = namedMember("unclear");
    const c = startWithSession(m);
    assert.equal(finish(c, "declined", { reasons: ["names_differ"] }).status, "with_staff");
    const row = checkRow(c.check);
    assert.deepEqual(row.reasons, ["names_differ", "provider_declined"]);
    assert.ok(queueCases().includes(row.case_id));
    // Only a reviewer holding a current claim on the case, and it is logged.
    fails(staff(moderator, `select api.get_identity_check_for_case('${row.case_id}');`), "42501");
    fails(member(m, `select api.get_identity_check_for_case('${row.case_id}');`), "42501");
    const held = claim(moderator, row.case_id);
    const logged = Number(
      q(`select count(*) from private.evidence_access_log where case_id='${row.case_id}';`)
    );
    const forCase = json(
      staff(moderator, `select api.get_identity_check_for_case('${row.case_id}');`)
    );
    assert.equal(forCase.check.status, "with_staff");
    assert.deepEqual(forCase.check.reasons, ["names_differ", "provider_declined"]);
    assert.equal(
      q(`select count(*)||':'||max(purpose) from private.evidence_access_log where case_id='${row.case_id}'
        and staff_id='${moderator.id}';`),
      `${logged + 1}:routine_review`
    );
    fails(staff(governor, `select api.get_identity_check_for_case('${row.case_id}');`), "42501");
    // A real staff return (Resubmit) sends it back to the member.
    const returned = json(
      staff(
        moderator,
        `select api.return_identity_submission('${row.case_id}',${held.version},'${held.claim_generation}','${held.claim_nonce}','Photo unclear, please retake it.');`
      )
    );
    assert.equal(returned.status, "needs_resubmission");
    assert.ok(!queueCases().includes(row.case_id));
    assert.equal(
      q(`select count(*) from private.accepted_identity_facts where owner_id='${m.id}';`),
      "0"
    );
  });
  await check(
    "the names the website compared are the names locked: a change mid-check is caught",
    () => {
      const m = namedMember("renamed");
      const c = startWithSession(m);
      const revision = q(`select revision from private.profiles where account_id='${m.id}';`);
      json(member(m, `select api.save_my_legal_name(${revision},'Thandiwe','Dlamini');`));
      json(service(`select api.begin_identity_check_evidence('${c.check}','${c.session}');`));
      assert.equal(json(service(completeSql(c, "approved"))).status, "with_staff");
      assert.deepEqual(checkRow(c.check).reasons, ["names_differ"]);
      assert.equal(
        q(`select count(*) from private.accepted_identity_facts where owner_id='${m.id}';`),
        "0"
      );
      assert.equal(
        q(`select legal_name_locked_at is null from private.profiles where account_id='${m.id}';`),
        "t"
      );
      // The names must come with every result.
      const d = startWithSession(namedMember("no-names"));
      json(service(`select api.begin_identity_check_evidence('${d.check}','${d.session}');`));
      fails(service(completeSql(d, "approved", { names: null })), "22023");
      fails(
        service(completeSql(d, "approved", { names: { first_name: "Thando Sipho" } })),
        "22023"
      );
    }
  );

  // --------------------------------------------------------- automatic
  let declined;
  await check("automatic: 'in review' is a decline; no queue shows it", () => {
    setMode("automatic");
    const m = namedMember("unsure");
    const c = startWithSession(m);
    assert.equal(finish(c, "in_review").status, "declined");
    const row = checkRow(c.check);
    assert.deepEqual(row.reasons, ["provider_in_review"]);
    assert.equal(
      q(
        `select count(*) from private.verification_current_submissions where case_id='${row.case_id}';`
      ),
      "0"
    );
    assert.ok(!queueCases().includes(row.case_id));
    assert.equal(
      q(`select provider_delete_due between declined_at+interval '5 days'-interval '1 second' and declined_at+interval '5 days'
        from private.identity_checks where id='${c.check}';`),
      "t"
    );
    const seen = availability(m);
    assert.equal(seen.check.status, "declined");
    assert.equal(seen.check.can_ask_person, true);
    assert.equal(seen.check.session_url, null);
    assert.equal(seen.check.reasons, undefined);
    declined = { member: m, ...c, case: row.case_id, submission: row.submission_id };
  });
  await check("automatic: a name changed mid-check is declined, never locked", () => {
    const m = namedMember("renamed-auto");
    const c = startWithSession(m);
    const revision = q(`select revision from private.profiles where account_id='${m.id}';`);
    json(member(m, `select api.save_my_legal_name(${revision},'Thando','Dlamini');`));
    assert.equal(finish(c, "approved").status, "declined");
    assert.deepEqual(checkRow(c.check).reasons, ["names_differ"]);
    assert.equal(
      q(`select legal_name_locked_at is null from private.profiles where account_id='${m.id}';`),
      "t"
    );
  });
  await check("automatic: banned, already verified and high risk IDs are declined", () => {
    const shared = fp();
    const first = namedMember("first-holder");
    finish(startWithSession(first), "approved", { fingerprint: shared });
    const copy = namedMember("second-holder");
    const c = startWithSession(copy);
    assert.equal(finish(c, "approved", { fingerprint: shared }).status, "declined");
    assert.deepEqual(checkRow(c.check).reasons, ["duplicate"]);

    const risky = namedMember("risky");
    const r = startWithSession(risky);
    assert.equal(finish(r, "approved", { risk: 60 }).status, "declined");
    assert.deepEqual(checkRow(r.check).reasons, ["high_risk"]);

    const bannedPrint = fp();
    q(`set session_replication_role=replica;
      insert into private.banned_identities(identity_hmac,decision_id,category,banned_at,retain_until)
        values('${bannedPrint}',gen_random_uuid(),'fraud',now(),now()+interval '5 years');
      set session_replication_role=origin;`);
    const banned = namedMember("banned");
    const b = startWithSession(banned);
    assert.equal(finish(b, "approved", { fingerprint: bannedPrint }).status, "declined");
    assert.deepEqual(checkRow(b.check).reasons, ["banned"]);
  });
  await check("ask a person: the request puts the submission back in the staff queue", () => {
    const m = declined.member;
    fails(
      member(m, `select api.ask_person_identity_check('${declined.check}','Too short.');`),
      "22023"
    );
    // No appeal is involved: the generic appeal path does not take a check.
    assert.match(
      fails(
        member(
          m,
          `select api.submit_my_frontend_appeal('${declined.check}','Please look at my ID again, it is mine.');`
        ),
        "PT409"
      ),
      /cannot be appealed/
    );
    const reason = "Please look at my ID again, the photo was taken in poor light.";
    const asked = json(
      member(m, `select api.ask_person_identity_check('${declined.check}',${sqlLiteral(reason)});`)
    );
    assert.equal(asked.reused, false);
    assert.equal(
      json(
        member(
          m,
          `select api.ask_person_identity_check('${declined.check}',${sqlLiteral(reason)});`
        )
      ).reused,
      true
    );
    assert.match(
      fails(
        member(
          m,
          `select api.ask_person_identity_check('${declined.check}','A different reason for the same check.');`
        ),
        "PT409"
      ),
      /ask_person_unavailable/
    );
    assert.equal(
      q(`select count(*) from private.frontend_appeals where action_id='${declined.check}';`),
      "0"
    );
    const row = checkRow(declined.check);
    assert.equal(row.ask_reason, reason);
    assert.equal(row.provider_delete_due, null);
    assert.ok(queueCases().includes(declined.case));
    assert.match(
      fails(member(m, "select api.start_my_identity_check();"), "PT409"),
      /identity_check_with_person/
    );
    const seen = availability(m);
    assert.equal(seen.check.can_ask_person, false);
    assert.equal(seen.check.with_person, true);
    assert.equal(
      json(staff(moderator, "select api.get_identity_check_settings();")).last_7_days.asked_person,
      1
    );
  });
  await check("a re-queued submission goes through the real staff approval", () => {
    const held = claim(moderator, declined.case);
    const forCase = json(
      staff(moderator, `select api.get_identity_check_for_case('${declined.case}');`)
    );
    assert.equal(forCase.check.ask_reason, checkRow(declined.check).ask_reason);
    const reviewed = json(
      staff(
        moderator,
        `select api.review_identity_submission('${declined.submission}',${held.version},'${held.claim_generation}','${held.claim_nonce}',true,true);`
      )
    );
    assert.equal(reviewed.status, "accepted");
    const fact = json(
      `select to_jsonb(f) from private.accepted_identity_facts f where f.owner_id='${declined.member.id}';`
    );
    assert.equal(fact.reviewed_by, moderator.id);
    assert.equal(fact.automatic_check_id, null);
    assert.equal(fact.submission_id, declined.submission);
    assert.equal(availability(declined.member).check.with_person, false);
    assert.equal(
      q(
        `select count(*) from private.outbox_events where kind='identity_accepted' and owner_id='${declined.member.id}';`
      ),
      "1"
    );
  });
  await check("a re-queued submission sent back by staff frees the member to try again", () => {
    const m = namedMember("sent-back");
    const c = startWithSession(m);
    finish(c, "declined");
    const row = checkRow(c.check);
    json(
      member(
        m,
        `select api.ask_person_identity_check('${c.check}','My ID is genuine, please check it by hand.');`
      )
    );
    const held = claim(moderator, row.case_id);
    assert.equal(
      json(
        staff(
          moderator,
          `select api.return_identity_submission('${row.case_id}',${held.version},'${held.claim_generation}','${held.claim_nonce}','Photo unclear, please retake it.');`
        )
      ).status,
      "needs_resubmission"
    );
    assert.equal(availability(m).check.with_person, false);
    assert.equal(start(m).created, true);
  });
  await check(
    "ask a person closes 5 days after the decline, and when a new attempt replaces it",
    () => {
      const late = namedMember("late");
      const c = startWithSession(late);
      finish(c, "declined");
      age(c.check, "5 days 1 minute");
      assert.equal(availability(late).check.can_ask_person, false);
      assert.match(
        fails(
          member(
            late,
            `select api.ask_person_identity_check('${c.check}','Please look again at my ID photo.');`
          ),
          "PT409"
        ),
        /ask_person_unavailable/
      );
      const again = namedMember("again");
      const first = startWithSession(again);
      finish(first, "declined");
      const second = startWithSession(again);
      finish(second, "declined");
      assert.match(
        fails(
          member(
            again,
            `select api.ask_person_identity_check('${first.check}','Please look again at my ID photo.');`
          ),
          "PT409"
        ),
        /ask_person_unavailable/
      );
      const stranger = namedMember("stranger");
      assert.match(
        fails(
          member(
            stranger,
            `select api.ask_person_identity_check('${second.check}','Please look again at my ID photo.');`
          ),
          "PT409"
        ),
        /ask_person_unavailable/
      );
    }
  );

  // ------------------------------------------------- partner deletions
  await check(
    "not finished: the partner's copy is due at once, held for 5 minutes, then marked",
    () => {
      const m = namedMember("abandoned");
      const c = startWithSession(m);
      assert.equal(finish(c, "not_finished").status, "not_finished");
      // LIM-F-claim_identity_check_deletions: 1 to 100 per call.
      fails(service(`select api.claim_identity_check_deletions(0);`), "22023");
      fails(service(`select api.claim_identity_check_deletions(101);`), "22023");
      const claimed = json(service("select api.claim_identity_check_deletions(100);"));
      assert.deepEqual(claimed, [{ check_id: c.check, session_id: c.session }]);
      assert.deepEqual(json(service("select api.claim_identity_check_deletions(100);")), []);
      const marked = json(
        service(`select api.mark_identity_check_provider_deleted('${c.check}');`)
      );
      assert.equal(marked.reused, false);
      assert.equal(
        json(service(`select api.mark_identity_check_provider_deleted('${c.check}');`)).reused,
        true
      );
      q(
        `update private.identity_checks set provider_delete_due=now()-interval '1 minute' where id='${c.check}';`
      );
      assert.deepEqual(json(service("select api.claim_identity_check_deletions(100);")), []);
    }
  );
  await check(
    "a declined check is due 5 days later; holds keep it; an unfinished one expires",
    () => {
      const m = namedMember("old-decline");
      const c = startWithSession(m);
      finish(c, "declined");
      assert.deepEqual(json(service("select api.claim_identity_check_deletions(100);")), []);
      age(c.check, "5 days 1 minute");
      q(
        `update private.identity_checks set provider_delete_due=declined_at+interval '5 days' where id='${c.check}';`
      );
      q(`insert into private.legal_holds(subject_id,reason,placed_by)
      values('${m.id}','Synthetic legal hold for the check.','${admin.id}');`);
      assert.deepEqual(json(service("select api.claim_identity_check_deletions(100);")), []);
      q(
        `update private.legal_holds set released_at=now(),released_by='${admin.id}' where subject_id='${m.id}';`
      );
      assert.deepEqual(
        json(service("select api.claim_identity_check_deletions(100);")).map((r) => r.check_id),
        [c.check]
      );

      const idle = namedMember("idle");
      const i = startWithSession(idle);
      age(i.check, "25 hours 1 minute");
      assert.equal(availability(idle).check.status, "not_finished");
      assert.deepEqual(
        json(service("select api.claim_identity_check_deletions(100);")).map((r) => r.check_id),
        [i.check]
      );
      assert.equal(checkRow(i.check).status, "not_finished");
      // A late result is not recorded over it.
      assert.equal(json(service(completeSql(i, "approved"))).reused, true);
    }
  );

  // ---------------------------------------------------- spending guard
  await check("LIM-SQL-IDENTITY-CHECK-MEMBER-7D: 3 checks per member in 7 days", () => {
    const m = namedMember("frequent");
    for (let n = 0; n < 3; n += 1) {
      const c = startWithSession(m);
      finish(c, "not_finished");
    }
    assert.deepEqual(availability(m).route, "manual");
    assert.equal(availability(m).reason, "limit");
    assert.match(
      fails(member(m, "select api.start_my_identity_check();"), "PT409"),
      /identity_check_limit/
    );
    q(`update private.identity_checks set created_at=created_at-interval '7 days',expires_at=expires_at-interval '7 days',
      finished_at=finished_at-interval '7 days' where id=(select id from private.identity_checks where owner_id='${m.id}'
      order by created_at limit 1);`);
    assert.equal(availability(m).route, "automatic");
  });
  await check(
    "LIM-SQL-IDENTITY-CHECK-DAY: 60 checks a day site-wide; unavailable ones do not count",
    () => {
      const counted = Number(
        q(
          `select count(*) from private.identity_checks where status<>'unavailable' and created_at>now()-interval '1 day';`
        )
      );
      q(`set session_replication_role=replica;
      insert into private.identity_checks(owner_id,case_id,status,created_at,expires_at,finished_at,start_first_name,start_last_name)
      select c.subject_id,c.id,'not_finished',now()-interval '1 hour',now()-interval '1 hour'+interval '24 hours',now(),'Thando','Dlamini'
        from private.evidence_cases c, generate_series(1,${59 - counted}) g
        where c.id=(select case_id from private.identity_checks order by created_at limit 1);
      set session_replication_role=origin;`);
      const m = namedMember("daily");
      assert.equal(availability(m).route, "automatic");
      const c = startWithSession(m);
      finish(c, "not_finished");
      const next = namedMember("daily-next");
      assert.deepEqual(availability(next), { route: "manual", reason: "limit", check: null });
      assert.match(
        fails(member(next, "select api.start_my_identity_check();"), "PT409"),
        /identity_check_limit/
      );
      q(`update private.identity_checks set status='unavailable' where id='${c.check}';`);
      assert.equal(availability(next).route, "automatic");
      q(
        `delete from private.identity_checks where status='not_finished' and created_at>now()-interval '2 hours' and session_id is null;`
      );
    }
  );
  await check(
    "a partner outage pauses everyone (15 minutes, 1 hour for credit); setting the mode resumes",
    () => {
      const m = namedMember("outage");
      const c = start(m).check_id;
      const first = json(service(`select api.report_identity_check_unavailable('${c}','outage');`));
      assert.equal(first.newly_paused, true);
      assert.equal(
        q(
          `select paused_until between now()+interval '14 minutes' and now()+interval '15 minutes' from private.identity_check_settings;`
        ),
        "t"
      );
      assert.equal(checkRow(c).status, "unavailable");
      const other = namedMember("outage-2");
      assert.deepEqual(availability(other), { route: "manual", reason: "paused", check: null });
      fails(member(other, "select api.start_my_identity_check();"), "PT409");
      q(`update private.identity_check_settings set paused_until=null,pause_reason=null;`);
      const d = start(other).check_id;
      q(
        `update private.identity_check_settings set paused_until=now()+interval '1 minute',pause_reason='outage';`
      );
      const second = json(
        service(`select api.report_identity_check_unavailable('${d}','no_credit');`)
      );
      assert.equal(second.newly_paused, false);
      assert.equal(
        q(
          `select paused_until between now()+interval '59 minutes' and now()+interval '1 hour' from private.identity_check_settings;`
        ),
        "t"
      );
      const resumed = setModeApi("manual", "Topped up the partner balance.");
      assert.deepEqual(resumed, { mode: "manual", changed: true, resumed: true });
      assert.equal(q(`select paused_until is null from private.identity_check_settings;`), "t");
      setMode("automatic");
      assert.equal(availability(other).route, "automatic");
      // A check with a session is not "unavailable".
      const s = startWithSession(namedMember("outage-3"));
      fails(
        service(`select api.report_identity_check_unavailable('${s.check}','outage');`),
        "PT409"
      );
    }
  );

  // ---------------------------------------------------- server commands
  await check("sessions bind once; results need the bound session and reserved files", () => {
    const m = namedMember("binding");
    const c = startWithSession(m);
    assert.equal(json(service(attachSql(c.check, c.session))).reused, true);
    fails(service(attachSql(c.check, randomUUID(), "https://verify.didit.me/session/x")), "PT409");
    fails(service(attachSql(c.check, randomUUID(), "https://example.com/session/x")), "22023");
    // The start context: a 64-hex network hash and the device kind, set once.
    const other = createHash("sha256").update("another network").digest("hex");
    fails(service(attachSql(c.check, c.session, undefined, other)), "PT409");
    fails(service(attachSql(c.check, c.session, undefined, NET, "computer")), "PT409");
    const d = start(namedMember("binding-2")).check_id;
    for (const [hash, kind] of [
      [NET.toUpperCase(), "phone"],
      [NET.slice(1), "phone"],
      [null, "phone"],
      [NET, "tablet"],
      [NET, null],
    ])
      fails(service(attachSql(d, randomUUID(), undefined, hash, kind)), "22023");
    // Only the website's server can set it.
    fails(member(m, attachSql(d, randomUUID())), "42501");
    assert.equal(checkRow(d).network_hash, null);
    const row = checkRow(c.check);
    assert.deepEqual(
      [row.start_first_name, row.start_last_name, row.network_hash, row.device_kind],
      ["Thando Sipho", "Dlamini", NET, "phone"]
    );
    fails(service(completeSql({ ...c, session: randomUUID() }, "approved")), "PT409");
    assert.match(fails(service(completeSql(c, "approved")), "PT409"), /not reserved/);
    fails(
      service(`select api.complete_identity_check('${c.check}','${c.session}','approved');`),
      "22023"
    );
    fails(
      service(
        `select api.complete_identity_check('${c.check}','${c.session}','approved',array['banned']::text[]);`
      ),
      "22023"
    );
    const files = json(
      service(`select api.begin_identity_check_evidence('${c.check}','${c.session}');`)
    );
    assert.deepEqual(
      json(service(`select api.begin_identity_check_evidence('${c.check}','${c.session}');`)),
      files
    );
    assert.match(files.id_front.object_key, /^evidence\//);
    assert.equal(files.owner_id, m.id);
    assert.deepEqual(files.start, {
      first_name: "Thando Sipho",
      last_name: "Dlamini",
      network_hash: NET,
      device_kind: "phone",
    });
  });
  await check("session_moved goes to staff on staff_final and is declined on automatic", () => {
    setMode("staff_final");
    const a = startWithSession(namedMember("moved-staff"));
    assert.equal(finish(a, "approved", { reasons: ["session_moved"] }).status, "with_staff");
    assert.deepEqual(checkRow(a.check).reasons, ["session_moved"]);
    setMode("automatic");
    const b = startWithSession(namedMember("moved-auto"));
    assert.equal(finish(b, "approved", { reasons: ["session_moved"] }).status, "declined");
    assert.deepEqual(checkRow(b.check).reasons, ["session_moved"]);
  });
  await check("a result after the 24-hour expiry is recorded as not finished", () => {
    const m = namedMember("too-late");
    const c = startWithSession(m);
    json(service(`select api.begin_identity_check_evidence('${c.check}','${c.session}');`));
    age(c.check, "24 hours 1 minute");
    assert.equal(json(service(completeSql(c, "approved"))).status, "not_finished");
    const row = checkRow(c.check);
    assert.equal(row.submission_id, null);
    assert.notEqual(row.provider_delete_due, null);
  });
  await check("manual at the moment the result arrives: the result goes to staff", () => {
    const m = namedMember("switched");
    const c = startWithSession(m);
    setMode("manual");
    json(service(`select api.begin_identity_check_evidence('${c.check}','${c.session}');`));
    assert.equal(json(service(completeSql(c, "approved"))).status, "with_staff");
    assert.equal(
      q(`select count(*) from private.accepted_identity_facts where owner_id='${m.id}';`),
      "0"
    );
  });

  await check("a new check needs a verified phone", () => {
    setMode("automatic");
    const m = namedMember("no-phone");
    q(`update private.verification_phone_proofs set revoked_at=now() where owner_id='${m.id}';`);
    assert.match(
      fails(member(m, "select api.start_my_identity_check();"), "PT409"),
      /verified_phone_required/
    );
    setMode("manual");
  });
  await check("the five-year history sweep removes a closed account's checks", () => {
    setMode("automatic");
    q(`update private.identity_checks set created_at=created_at-interval '8 days',expires_at=expires_at-interval '8 days',
      finished_at=finished_at-interval '8 days',declined_at=declined_at-interval '8 days'
      where created_at>clock_timestamp()-interval '8 days';`);
    const a = namedMember("sweep-declined");
    finish(startWithSession(a), "declined");
    const b = namedMember("sweep-unavailable");
    json(service(`select api.report_identity_check_unavailable('${start(b).check_id}','outage');`));
    q(
      `update private.identity_check_settings set paused_until=null,pause_reason=null,mode='manual';`
    );
    const ids = `'${a.id}','${b.id}'`;
    q(`set session_replication_role=replica;
      insert into private.account_closures(user_id,closed_at,evidence_delete_after)
        select u,now()-interval '6 years',now()-interval '6 years'+interval '90 days' from unnest(array[${ids}]::uuid[]) u;
      update private.evidence_artifacts set state='deleted',deleted_at=now()-interval '6 years' where owner_id in (${ids});
      update private.evidence_cases set status='closed' where subject_id in (${ids}) and status='open';
      set session_replication_role=origin;`);
    assert.equal(
      q(`select count(*) from private.identity_checks where owner_id in (${ids});`),
      "2"
    );
    const swept = json(service("select api.run_retention(100);"));
    assert.ok(swept.verification.closed_account_verification_histories >= 2, JSON.stringify(swept));
    assert.equal(
      q(`select count(*) from private.identity_checks where owner_id in (${ids});`),
      "0"
    );
    assert.equal(
      q(
        `select count(*) from private.verification_identity_submissions where owner_id in (${ids});`
      ),
      "0"
    );
  });

  // ------------------------------------------------- later updates
  applySteps(database, steps.slice(index + 1));
  await check("later updates apply after this one", () => {
    assert.equal(q(`select to_regclass('private.identity_checks') is not null;`), "t");
  });
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Automatic identity checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
