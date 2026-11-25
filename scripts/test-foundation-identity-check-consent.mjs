#!/usr/bin/env node
// Behaviour checks for 20261124235920_identity_check_consent.sql: a new
// automatic ID check records the member's consent (version and time), a start
// without the current consent version creates no check, a call without the
// argument keeps every earlier answer, and staff see the consent on the case
// and each case's check status and reason codes in the queue.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members and staff call as `authenticated` with synthetic claims and a
// live session row; the website's server calls as `service_role`. The script
// runs the update's read-only preflight, checks its refusals, applies it,
// checks the rules, and proves apply -> rollback -> apply returns the same
// fingerprints. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-identity-check-consent.mjs
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

const UPDATE = "20261124235920_identity_check_consent.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const REPLACED = [
  "internal.start_my_identity_check()",
  "api.start_my_identity_check()",
  "internal.get_identity_check_for_case(uuid)",
  "internal.get_frontend_staff_verification_queue(integer,uuid[])",
];
const CONSENT = "identity-check-consent-v1";
const NOT_APPLIED =
  /^identity check consent: update not applied; mode: \w+; checks: \d+; started: \d+$/;
const APPLIED =
  /^identity check consent: already applied; mode: \w+; checks: \d+; started: \d+; with consent: \d+$/;

const opened = await openUpdateCheck(PREFLIGHT);
const { started, database, check, current, q, json, fails, member, staff, service } = opened;
const { fingerprint, bodyMd5, syntheticMember, passed: checks } = opened;
const preflight = opened.preflightRows;
const hex = (bytes) => randomBytes(bytes).toString("hex");
const fp = () =>
  `${createHash("sha256").update(`consent-${randomUUID()}`).digest("base64url").slice(0, 42)}Q`;
const encrypted = () => ({
  ciphertext: hex(13),
  iv: hex(12),
  tag: hex(16),
  key_id: "identity-number-v1",
});
const receipt = () => ({ stored_sha256: hex(32), content_sha256: hex(32), size: 54321 });
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);

  syntheticMember("setup");
  q(`create or replace function vmtest.staff_member(p_label text,p_role text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      update auth.sessions set aal='aal2' where id=(m->>'session')::uuid;
      insert into auth.mfa_factors(user_id,factor_type,status) values((m->>'id')::uuid,'totp','verified');
      if p_role is not null then insert into private.staff_roles(user_id,role) values((m->>'id')::uuid,p_role); end if;
      return m;
    end$$;
    create or replace function vmtest.named_member(p_label text,p_phone boolean) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      perform set_config('session_replication_role','replica',true);
      insert into private.profiles(account_id) values((m->>'id')::uuid) on conflict(account_id) do nothing;
      update private.profiles set legal_first_name='Thando Sipho',legal_last_name='Dlamini' where account_id=(m->>'id')::uuid;
      if p_phone then
        insert into private.verification_phone_proofs(owner_id,challenge_id,phone)
          values((m->>'id')::uuid,gen_random_uuid(),'+2783'||lpad((floor(random()*1e7))::bigint::text,7,'0'));
      end if;
      perform set_config('session_replication_role','origin',true);
      return m;
    end$$;`);
  const staffMember = (label, role) =>
    json(`select vmtest.staff_member(${sqlLiteral(label)},${role ? sqlLiteral(role) : "null"});`);
  const namedMember = (label, phone = true) =>
    json(`select vmtest.named_member(${sqlLiteral(label)},${phone});`);
  const admin = staffMember("admin", "admin");
  const moderator = staffMember("moderator", "moderator");
  const secondModerator = staffMember("moderator-2", "moderator");
  const setMode = (mode, reason = "Owner decision for automatic ID checks.") =>
    json(staff(admin, `select api.set_identity_check_mode('${mode}',${sqlLiteral(reason)});`));
  const startSql = (version) =>
    version === undefined
      ? "select api.start_my_identity_check();"
      : `select api.start_my_identity_check(${version === null ? "null" : sqlLiteral(version)});`;
  const start = (who, version) => json(member(who, startSql(version)));
  /** The SQLSTATE and detail of a refused start. */
  const refusal = (who, version) => {
    const stderr = fails(member(who, startSql(version)), "PT409");
    return /DETAIL:\s+(\S+)/.exec(stderr)?.[1] ?? "none";
  };
  const checksOf = (who) =>
    Number(q(`select count(*) from private.identity_checks where owner_id='${who.id}';`));
  const checkRow = (id) =>
    json(`select to_jsonb(k) from private.identity_checks k where k.id='${id}';`);
  const NET = createHash("sha256").update("synthetic network").digest("hex");
  const attach = (checkId) => {
    const session = randomUUID();
    json(
      service(
        `select api.attach_identity_check_session('${checkId}','${session}','https://verify.didit.me/session/${session}','${NET}','phone');`
      )
    );
    return { check: checkId, session };
  };
  /** Records an automatic result with the given reasons, as the server would. */
  const finish = (c, outcome, reasons) => {
    json(service(`select api.begin_identity_check_evidence('${c.check}','${c.session}');`));
    return json(
      service(`select api.complete_identity_check('${c.check}','${c.session}','${outcome}',array[${reasons.map(sqlLiteral).join(",")}]::text[],
        ${sqlJsonb(receipt())},${sqlJsonb(receipt())},${sqlJsonb({ fingerprint: fp(), encrypted_number: encrypted() })},
        ${sqlJsonb({ first_name: "Thando Sipho", last_name: "Dlamini" })},10);`)
    );
  };

  // ------------------------------------------------------------ before
  await check("before the update: the replaced functions are the reviewed bodies", () => {
    for (const sig of REPLACED) assert.notEqual(bodyMd5(sig), "missing", sig);
    assert.equal(bodyMd5("internal.identity_check_consent_version()"), "missing");
    assert.equal(bodyMd5("api.start_my_identity_check(text)"), "missing");
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], NOT_APPLIED);
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () =>
    assertDriftRefused(
      { q, fails, fingerprint, preflightRows: preflight },
      {
        rollback: ROLLBACK,
        updateSql: step.sql,
        signatures: REPLACED,
        drift: /identity check consent drift/,
      }
    )
  );

  // The answers of a start without the argument before the update, and a
  // check started then (no consent recorded), carried across the update.
  setMode("staff_final", "Didit checks, staff have the final say.");
  const noPhone = namedMember("no-phone", false);
  const beforeNoPhone = refusal(noPhone);
  const runner = namedMember("runner");
  const running = start(runner);
  assert.equal(running.created, true);
  setMode("manual", "Back to staff review.");
  const offMember = namedMember("setting-off");
  const beforeOff = refusal(offMember);

  await check("the update and its preflight refuse unless the setting is Manual", () => {
    const before = fingerprint();
    for (const mode of ["staff_final", "automatic"]) {
      setMode(mode, `Testing the ${mode} setting.`);
      const rows = preflight();
      assert.deepEqual(
        rows.map((r) => r[0]),
        ["summary", "problem"],
        JSON.stringify(rows)
      );
      assert.match(rows[0][1], NOT_APPLIED);
      assert.match(
        rows[1][1],
        new RegExp(`^the automatic ID check setting is ${mode}; set it to Manual`)
      );
      fails(step.sql, "55000", /the automatic ID check setting must be Manual/);
    }
    setMode("manual", "Back to staff review.");
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "identity check consent",
    fingerprint,
    preflightRows: preflight,
    appliedSummary: APPLIED,
  });
  setMode("staff_final", "Didit checks, staff have the final say.");

  await check("grants: the start for members only, security invoker; helpers for nobody", () => {
    const grants = executeGrants(json, [
      "api.start_my_identity_check(text)",
      "internal.start_my_identity_check(text)",
      "internal.identity_check_consent_version()",
      "internal.identity_check_consent_required()",
    ]);
    const memberOnly = { anon: false, authenticated: true, service_role: false };
    const nobody = { anon: false, authenticated: false, service_role: false };
    assert.deepEqual(grants["api.start_my_identity_check(text)"], memberOnly);
    assert.deepEqual(grants["internal.start_my_identity_check(text)"], memberOnly);
    assert.deepEqual(grants["internal.identity_check_consent_version()"], nobody);
    assert.deepEqual(grants["internal.identity_check_consent_required()"], nobody);
    assert.equal(
      q(
        `select prosecdef::text||':'||pronargdefaults from pg_proc where oid='api.start_my_identity_check(text)'::regprocedure;`
      ),
      "false:1",
      "invoker, and the argument is optional"
    );
    for (const gone of ["api.start_my_identity_check()", "internal.start_my_identity_check()"])
      assert.equal(bodyMd5(gone), "missing", gone);
    fails(`set role anon;\nselect api.start_my_identity_check('${CONSENT}');`, "42501");
    fails(service(`select api.start_my_identity_check('${CONSENT}');`), "42501");
  });

  await check("the current consent version is named in one place", () => {
    assert.equal(q("select internal.identity_check_consent_version();"), CONSENT);
  });

  await check("a start without consent is refused and creates no check", () => {
    const m = namedMember("no-consent");
    assert.equal(refusal(m), "identity_check_consent_required");
    assert.equal(refusal(m, null), "identity_check_consent_required");
    assert.equal(refusal(m, ""), "identity_check_consent_required");
    assert.equal(checksOf(m), 0);
  });

  await check("a start with another version is refused and creates no check", () => {
    const m = namedMember("old-consent");
    for (const version of ["identity-check-consent-v0", "identity-check-consent-v2", ` ${CONSENT}`])
      assert.equal(refusal(m, version), "identity_check_consent_required", version);
    assert.equal(checksOf(m), 0);
  });

  await check("a start with the current version records the version and the time", () => {
    const m = namedMember("consents");
    const begun = start(m, CONSENT);
    assert.equal(begun.created, true);
    const row = checkRow(begun.check_id);
    assert.equal(row.consent_version, CONSENT);
    assert.equal(row.consented_at, row.created_at, "consented when the check started");
    // The same check is returned while it runs, with or without the argument.
    assert.equal(start(m, CONSENT).check_id, begun.check_id);
    assert.equal(start(m).check_id, begun.check_id);
    assert.equal(start(m, "identity-check-consent-v0").created, false);
  });

  await check("the rollback refuses unless Manual, and once a consent is recorded", () => {
    const before = fingerprint();
    // Staff final, with a consented check from the check above.
    fails(ROLLBACK, "55000", /rollback refused: the automatic ID check setting must be Manual/);
    setMode("manual", "Back to staff review.");
    fails(
      ROLLBACK,
      "55000",
      /rollback refused: checks have recorded members' consent; write a forward update instead/
    );
    setMode("staff_final", "Didit checks, staff have the final say.");
    assert.equal(fingerprint(), before);
  });

  await check("the table refuses a check without consent, whoever writes it", () => {
    const m = namedMember("direct-insert");
    const caseId = json(member(m, "select api.open_verification_case();")).case_id;
    const insert = (columns, values) =>
      `insert into private.identity_checks(owner_id,case_id,created_at,expires_at,start_first_name,start_last_name${columns})
        values('${m.id}','${caseId}',now(),now()+interval '24 hours','Thando Sipho','Dlamini'${values});`;
    fails(insert("", ""), "PT409", /identity_check_consent_required/);
    fails(insert(",consent_version", `,'${CONSENT}'`), "PT409", /identity_check_consent_required/);
    fails(
      insert(",consent_version,consented_at", ",'identity-check-consent-v0',now()"),
      "PT409",
      /identity_check_consent_required/
    );
    assert.equal(checksOf(m), 0);
  });

  await check("a call without the argument keeps every earlier answer", () => {
    // The same refusals as before the update.
    assert.equal(beforeNoPhone, "verified_phone_required");
    assert.equal(refusal(noPhone), beforeNoPhone);
    setMode("manual", "Back to staff review.");
    assert.equal(beforeOff, "identity_check_mode");
    assert.equal(refusal(offMember), beforeOff);
    setMode("staff_final", "Didit checks, staff have the final say.");
    // A check started before the update (no consent recorded) carries on: it
    // is returned, takes its partner session and records its result.
    const resumed = start(runner);
    assert.deepEqual(
      { id: resumed.check_id, created: resumed.created },
      { id: running.check_id, created: false }
    );
    assert.equal(checkRow(running.check_id).consent_version, null);
    const c = attach(running.check_id);
    assert.equal(finish(c, "approved", ["session_moved"]).status, "with_staff");
  });

  let caseRead;
  await check("staff: the case read shows the consent of the check", () => {
    const m = namedMember("case-read");
    const begun = start(m, CONSENT);
    const c = attach(begun.check_id);
    assert.equal(finish(c, "declined", ["names_differ"]).status, "with_staff");
    const row = checkRow(begun.check_id);
    caseRead = row.case_id;
    json(staff(moderator, `select api.claim_evidence_case('${row.case_id}');`));
    const forCase = json(
      staff(moderator, `select api.get_identity_check_for_case('${row.case_id}');`)
    ).check;
    assert.equal(forCase.consent_version, CONSENT);
    assert.equal(forCase.consented_at, row.consented_at);
    // The check started before the update shows no consent.
    const earlier = checkRow(running.check_id);
    json(staff(secondModerator, `select api.claim_evidence_case('${earlier.case_id}');`));
    const old = json(
      staff(secondModerator, `select api.get_identity_check_for_case('${earlier.case_id}');`)
    ).check;
    assert.deepEqual([old.consent_version, old.consented_at], [null, null]);
  });

  await check("staff: the queue shows each case's latest check, its status only", () => {
    const groups = json(
      staff(moderator, "select api.get_frontend_staff_verification_queue(100,'{}')->'groups';")
    );
    const byCase = new Map(groups.map((g) => [g.case_id, g.identity_check]));
    assert.deepEqual(byCase.get(caseRead), { status: "with_staff" });
    const earlier = checkRow(running.check_id);
    assert.deepEqual(byCase.get(earlier.case_id), { status: "with_staff" });
    for (const g of groups)
      if (g.identity_check !== null) assert.deepEqual(Object.keys(g.identity_check), ["status"]);
  });

  await check("the preflight counts checks with consent after the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"]
    );
    assert.match(rows[0][1], APPLIED);
    assert.match(rows[0][1], /; with consent: 2$/);
  });

  // ------------------------------------------------- later updates
  applySteps(database, steps.slice(index + 1));
  await check("later updates apply after this one", () => {
    assert.equal(
      q(`select to_regprocedure('api.start_my_identity_check(text)') is not null;`),
      "t"
    );
  });
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Identity check consent passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
