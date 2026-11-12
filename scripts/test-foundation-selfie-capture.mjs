#!/usr/bin/env node
// Behaviour checks for 20261111184619_selfie_capture_method.sql: how the
// member's browser says the selfie was taken (camera or uploaded file, and the
// browser's liveness answer) is stored with the identity case's selfie upload
// receipt, and staff who hold the case can read it.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, sends members' ID and selfie through the production upload commands
// (member calls as `authenticated` with synthetic claims and a live session
// row, the website's server calls as `service_role`), runs the update's
// read-only preflight, applies the update, checks what is stored, who can
// write and read it and when it goes, and proves that apply -> rollback ->
// apply returns the schema fingerprint to the same values each time. Any later
// updates are applied at the end and the stored answers are checked again.
//
//   node --import tsx scripts/test-foundation-selfie-capture.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Members
// and staff are written directly as the database owner (staff with a verified
// authenticator app and an AAL2 session). Evidence hashes and the encrypted ID
// number receipt are synthetic; no object storage is involved.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  assertReadOnlyPreflight,
  createChecks,
  sqlHelpers,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261111184619_selfie_capture_method.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");
const RECORD = "record_my_selfie_capture(uuid,text,boolean)";
const READ = "get_frontend_staff_selfie_capture(uuid,text,uuid)";
const SCRUB = "internal.scrub_frontend_verification_receipt()";
const COMPLETE = "complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer)";

const { check, current, passed: checks } = createChecks();

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);

  // ---------------------------------------------------------------- helpers
  const { q, json, fails, claims, as, member, staff, service } = sqlHelpers(database, current);
  const anon = (sql) => `set role anon;\n${sql}`;
  const fingerprint = () => q(`set search_path to pg_catalog;\n${FINGERPRINT}`);
  const preflight = () =>
    q(PREFLIGHT)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|"));
  const hex = (bytes) => randomBytes(bytes).toString("hex");
  const bodyOf = (sig) =>
    q(
      `select coalesce((select md5(replace(prosrc,E'\\r\\n',E'\\n')) from pg_proc where oid=to_regprocedure('${sig}')),'missing');`
    );

  // ------------------------------------------------------- synthetic world
  q(`create schema vmtest;
    create function vmtest.member(p_label text) returns jsonb language plpgsql as $$
    declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(uid,p_label||'-'||uid||'@example.invalid',now(),jsonb_build_object('display_name','Fixture '||p_label));
      insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
      return jsonb_build_object('id',uid,'session',sid);
    end$$;
    create function vmtest.staff(p_label text,p_role text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      update auth.sessions set aal='aal2' where id=(m->>'session')::uuid;
      insert into auth.mfa_factors(user_id,factor_type,status) values((m->>'id')::uuid,'totp','verified');
      insert into private.staff_roles(user_id,role) values((m->>'id')::uuid,p_role);
      return m;
    end$$;`);
  const user = (label) => json(`select vmtest.member('${label}');`);
  const reviewer = json(`select vmtest.staff('reviewer','admin');`);

  /** A synthetic encrypted ID number receipt, in the shape the website sends. */
  const identityReceipt = () => ({
    fingerprint: `${randomBytes(32).toString("base64url").slice(0, 42)}A`,
    encrypted_number: {
      ciphertext: hex(13),
      iv: hex(12),
      tag: hex(16),
      key_id: "identity-number-v1",
    },
  });
  const reserve = (owner, purpose) => {
    const request = randomUUID();
    const names = purpose === "id_front" ? ",'Fixture','Member'" : "";
    const reserved = json(
      member(
        owner,
        `select api.reserve_frontend_verification_upload('${request}','${purpose}','${hex(32)}'${names});`
      )
    );
    assert.equal(reserved.completed, false);
    return { request, artifact: reserved.artifact_id };
  };
  /** The website's server completing an upload (unchanged by the update). */
  const complete = (owner, request, purpose) =>
    json(
      service(
        `select api.complete_frontend_verification_upload('${owner.id}','${request}','${hex(32)}','${hex(32)}',128,` +
          (purpose === "id_front"
            ? `'${JSON.stringify(identityReceipt())}'::jsonb,null);`
            : "null,10);")
      )
    );
  /** The website recording the browser's answer with the member's session. */
  const recordSql = (owner, request, method, passed) =>
    member(owner, `select api.record_my_selfie_capture('${request}',${method},${passed});`);
  const record = (owner, request, method, passed) =>
    json(recordSql(owner, request, `'${method}'`, passed));
  /** ID and selfie of a new member through the production upload commands,
   * with the browser's answer recorded before completion when given. */
  const submit = (label, report) => {
    const owner = user(label);
    const id = reserve(owner, "id_front");
    complete(owner, id.request, "id_front");
    const selfie = reserve(owner, "selfie");
    if (report)
      assert.deepEqual(record(owner, selfie.request, ...report), {
        recorded: true,
      });
    assert.deepEqual(complete(owner, selfie.request, "selfie"), {
      completed: true,
      artifact_id: selfie.artifact,
      purpose: "selfie",
    });
    const caseId = q(
      `select case_id from private.frontend_verification_uploads where request_id='${selfie.request}';`
    );
    return { owner, id, selfie, caseId };
  };
  // to_jsonb reads the columns by name, so this also works before the update.
  const stored = (receipt) =>
    json(
      `select jsonb_build_object('capture_method',to_jsonb(u)->'capture_method','browser_liveness_passed',to_jsonb(u)->'browser_liveness_passed') ` +
        `from private.frontend_verification_uploads u where request_id='${receipt.request}';`
    );
  const none = { capture_method: null, browser_liveness_passed: null };
  const lease = (caseId) => json(staff(reviewer, `select api.claim_evidence_case('${caseId}');`));
  const readCapture = (caseId, held, who = reviewer) =>
    staff(
      who,
      `select api.get_frontend_staff_selfie_capture('${caseId}','${held.claim_generation}','${held.claim_nonce}');`
    );

  // ------------------------------------------------------------ before
  let early;
  await check("before the update: the commands do not exist and uploads complete", () => {
    assert.equal(bodyOf(`api.${RECORD}`), "missing");
    assert.equal(bodyOf(`api.${READ}`), "missing");
    early = submit("early");
    fails(recordSql(early.owner, randomUUID(), "'camera'", true), "42883");
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
      /^selfie capture method: reviewed bodies, update not applied \(apply before the website release that uses it is deployed\); selfie receipts: [1-9]\d*; with a capture method: 0$/
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    const live = q(`select pg_get_functiondef('${SCRUB}'::regprocedure);`);
    // The same function with one more space at the start of its body.
    q(
      `do $$begin execute replace(pg_get_functiondef('${SCRUB}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[1][1], /is not the reviewed body/);
    assert.match(fails(step.sql, "55000"), /receipt scrub drift/);
    q(`${live};`);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  const before = fingerprint();
  const completeBody = bodyOf(`internal.${COMPLETE}`);
  applySteps(database, [step]);
  const after = fingerprint();
  let uploaded, live, unverified, silent;
  await check("the selfie's capture report is stored with the case", () => {
    assert.notEqual(after, before);
    // The upload completion is untouched.
    assert.equal(bodyOf(`internal.${COMPLETE}`), completeBody);
    assert.match(preflight()[0][1], /^selfie capture method: already applied; /);
    assert.equal(preflight().length, 1);
    uploaded = submit("uploaded", ["file_upload", false]);
    live = submit("live", ["camera", true]);
    unverified = submit("unverified", ["camera", false]);
    // The website deployed before the update records nothing.
    silent = submit("silent");
    assert.deepEqual(stored(uploaded.selfie), {
      capture_method: "file_upload",
      browser_liveness_passed: false,
    });
    assert.deepEqual(stored(live.selfie), {
      capture_method: "camera",
      browser_liveness_passed: true,
    });
    assert.deepEqual(stored(unverified.selfie), {
      capture_method: "camera",
      browser_liveness_passed: false,
    });
    assert.deepEqual(stored(silent.selfie), none);
    assert.deepEqual(stored(early.selfie), none);
    assert.deepEqual(stored(uploaded.id), none);
    // The receipt belongs to the case's current submission.
    assert.equal(
      q(
        `select count(*) from private.frontend_verification_uploads u join private.verification_current_submissions v on v.submission_id=u.submission_id ` +
          `where u.request_id='${uploaded.selfie.request}' and v.case_id='${uploaded.caseId}' and u.case_id='${uploaded.caseId}';`
      ),
      "1"
    );
    assert.match(preflight()[0][1], /; with a capture method: 3$/);
  });
  await check(
    "only the member's own uncompleted selfie takes a report, from the closed set",
    () => {
      const owner = user("refused");
      const id = reserve(owner, "id_front");
      // Not on the ID document's receipt.
      fails(
        recordSql(owner, id.request, "'file_upload'", false),
        "22023",
        /selfie upload request required/
      );
      complete(owner, id.request, "id_front");
      const selfie = reserve(owner, "selfie");
      for (const [method, passed] of [
        ["'screen'", false],
        ["'file_upload'", true],
        ["'Camera'", false],
        ["'camera'", null],
        ["null", false],
      ])
        fails(
          recordSql(owner, selfie.request, method, passed),
          "22023",
          /browser capture report invalid/
        );
      fails(
        member(owner, `select api.record_my_selfie_capture(null,'camera',true);`),
        "22023",
        /browser capture report invalid/
      );
      // Not on another member's receipt, nor an unknown one.
      fails(
        recordSql(live.owner, selfie.request, "'camera'", true),
        "22023",
        /selfie upload request required/
      );
      fails(
        recordSql(owner, randomUUID(), "'camera'", true),
        "22023",
        /selfie upload request required/
      );
      assert.deepEqual(stored(selfie), none);
      // Before completion the latest answer counts; afterwards nothing changes.
      record(owner, selfie.request, "camera", true);
      assert.deepEqual(record(owner, selfie.request, "file_upload", false), { recorded: true });
      complete(owner, selfie.request, "selfie");
      assert.deepEqual(record(owner, selfie.request, "camera", true), { recorded: false });
      assert.deepEqual(stored(selfie), {
        capture_method: "file_upload",
        browser_liveness_passed: false,
      });
      // An expired upload request takes no report.
      const other = user("expired");
      const otherId = reserve(other, "id_front");
      complete(other, otherId.request, "id_front");
      const late = reserve(other, "selfie");
      q(
        `update private.frontend_verification_uploads set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where request_id='${late.request}';`
      );
      fails(recordSql(other, late.request, "'camera'", true), "PT409");
      // A member without a live session cannot record.
      fails(
        as(
          { ...claims(other), session_id: randomUUID() },
          recordSql(other, late.request, "'camera'", true).split("\n").at(-1)
        ),
        "42501"
      );
      // The table refuses inconsistent values written any other way.
      for (const set of [
        "capture_method='camera',browser_liveness_passed=null",
        "capture_method='screen',browser_liveness_passed=false",
        "capture_method='file_upload',browser_liveness_passed=true",
      ])
        fails(
          `update private.frontend_verification_uploads set ${set} where request_id='${selfie.request}';`,
          "23514"
        );
      fails(
        `update private.frontend_verification_uploads set capture_method='camera',browser_liveness_passed=true where request_id='${id.request}';`,
        "23514"
      );
    }
  );
  await check("staff holding the case read the capture report", () => {
    const expected = [
      [uploaded, "file_upload", false],
      [live, "camera", true],
      [unverified, "camera", false],
      [silent, null, null],
      [early, null, null],
    ];
    for (const [entry, method, passed] of expected) {
      const held = lease(entry.caseId);
      const answer = json(readCapture(entry.caseId, held));
      const submission = q(
        `select submission_id from private.verification_current_submissions where case_id='${entry.caseId}';`
      );
      const version = Number(
        q(`select version from private.evidence_cases where id='${entry.caseId}';`)
      );
      assert.deepEqual(answer, {
        case_id: entry.caseId,
        case_version: version,
        submission_id: submission,
        selfie_artifact_id: entry.selfie.artifact,
        capture_method: method,
        browser_liveness_passed: passed,
      });
      // Reading the answer opens no evidence: no access log row.
      assert.equal(
        q(`select count(*) from private.evidence_access_log where case_id='${entry.caseId}';`),
        "0"
      );
      entry.held = held;
    }
  });
  await check("nobody else reads it, and the commands keep their audiences", () => {
    const held = uploaded.held;
    const call = `select api.get_frontend_staff_selfie_capture('${uploaded.caseId}','${held.claim_generation}','${held.claim_nonce}');`;
    // Signed-out visitors, the website's service role and members have no access.
    fails(anon(call), "42501");
    fails(service(call), "42501");
    fails(member(uploaded.owner, call), "42501");
    fails(member(live.owner, call), "42501");
    // Another staff member without the claim, and a stale or forged claim.
    const other = json(`select vmtest.staff('other','admin');`);
    fails(
      readCapture(uploaded.caseId, held, other),
      "42501",
      /current live evidence claim required/
    );
    fails(
      readCapture(uploaded.caseId, { ...held, claim_nonce: randomUUID() }),
      "42501",
      /current live evidence claim required/
    );
    fails(
      readCapture(uploaded.caseId, { ...held, claim_generation: "x" }),
      "22023",
      /claim generation and nonce required/
    );
    // A claim on one case does not read another case.
    fails(readCapture(live.caseId, held), "42501", /current live evidence claim required/);
    fails(readCapture(randomUUID(), held), "22023", /case unavailable/);
    // An expired claim.
    q(
      `update private.evidence_cases set claim_expires_at=clock_timestamp()-interval '1 second' where id='${uploaded.caseId}';`
    );
    fails(readCapture(uploaded.caseId, held), "42501", /current live evidence claim required/);
    // A staff session without a recent authenticator code.
    fails(
      as(
        claims(reviewer),
        `select api.get_frontend_staff_selfie_capture('${live.caseId}','${live.held.claim_generation}','${live.held.claim_nonce}');`
      ),
      "42501"
    );
    // Only members record, and only through their own session.
    const recordCall = `select api.record_my_selfie_capture('${randomUUID()}','camera',true);`;
    fails(anon(recordCall), "42501");
    fails(service(recordCall), "42501");
    const grants =
      json(`select jsonb_object_agg(f, (select jsonb_object_agg(r, has_function_privilege(r,f,'execute'))
        from unnest(array['anon','authenticated','service_role']) r))
      from unnest(array['api.${READ}','internal.${READ}','api.${RECORD}','internal.${RECORD}','api.${COMPLETE}','internal.${COMPLETE}','${SCRUB}']) f;`);
    const member_ = { anon: false, authenticated: true, service_role: false };
    const server = { anon: false, authenticated: false, service_role: true };
    const nobody = { anon: false, authenticated: false, service_role: false };
    assert.deepEqual(grants, {
      [`api.${READ}`]: member_,
      [`internal.${READ}`]: member_,
      [`api.${RECORD}`]: member_,
      [`internal.${RECORD}`]: member_,
      [`api.${COMPLETE}`]: server,
      [`internal.${COMPLETE}`]: server,
      [SCRUB]: nobody,
    });
    const definer =
      json(`select jsonb_object_agg(p.oid::regprocedure::text, p.prosecdef) from pg_proc p
      where p.proname in('record_my_selfie_capture','get_frontend_staff_selfie_capture');`);
    assert.deepEqual(definer, {
      [`api.${RECORD}`]: false,
      [`internal.${RECORD}`]: true,
      [`api.${READ}`]: false,
      [`internal.${READ}`]: true,
    });
  });
  await check("the report goes when the selfie file is deleted", () => {
    // Evidence retention marks the file deleted; the receipt scrub clears the
    // report with the ID number receipt.
    q(
      `update private.evidence_artifacts set state='cleanup_required' where id='${live.selfie.artifact}';
` +
        `update private.evidence_artifacts set state='deleted',deleted_at=clock_timestamp() where id='${live.selfie.artifact}';`
    );
    assert.deepEqual(stored(live.selfie), none);
    assert.deepEqual(stored(uploaded.selfie), {
      capture_method: "file_upload",
      browser_liveness_passed: false,
    });
  });
  await check("apply, roll back and apply again are clean", () => {
    applySteps(database, [{ label: "selfie capture rollback", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before, "the rollback leaves the pre-update schema");
    assert.equal(bodyOf(`api.${RECORD}`), "missing");
    assert.equal(bodyOf(`api.${READ}`), "missing");
    assert.match(preflight()[0][1], /^selfie capture method: reviewed bodies, update not applied/);
    submit("after-rollback");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
    const again = submit("reapplied", ["file_upload", false]);
    assert.deepEqual(stored(again.selfie), {
      capture_method: "file_upload",
      browser_liveness_passed: false,
    });
    uploaded = again;
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the stored reports and the commands", () => {
      assert.deepEqual(stored(uploaded.selfie), {
        capture_method: "file_upload",
        browser_liveness_passed: false,
      });
      const held = lease(uploaded.caseId);
      assert.equal(json(readCapture(uploaded.caseId, held)).capture_method, "file_upload");
      submit("later", ["camera", true]);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Selfie capture method checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
