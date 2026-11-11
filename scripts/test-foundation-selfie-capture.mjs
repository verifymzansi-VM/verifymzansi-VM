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
// read-only preflight, applies the update, checks what is stored and who can
// read it, and proves that apply -> rollback -> apply returns the schema
// fingerprint to the same values each time. Any later updates are applied at
// the end and the stored answers are checked again.
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
import { replaySteps } from "./lib/foundation-replay.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261111184619_selfie_capture_method.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");
const OLD = "(uuid,uuid,text,text,integer,jsonb,integer)";
const NEW = "(uuid,uuid,text,text,integer,jsonb,integer,text,boolean)";
const READ = "(uuid,text,uuid)";

const checks = [];
let current = "start";
function check(id, fn) {
  current = id;
  return Promise.resolve(fn()).then(() => {
    checks.push(id);
    console.log(`PASS ${id}`);
  });
}

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { steps } = replaySteps();
  const index = steps.findIndex((step) => step.label === UPDATE);
  assert.ok(index > 0, `${UPDATE} is missing`);
  const step = steps[index];
  applySteps(database, steps.slice(0, index));

  // ---------------------------------------------------------------- helpers
  const run = (sql) => database.psql(`\\set VERBOSITY verbose\n${sql}`, ["-A", "-t"]);
  const q = (sql) => {
    const result = run(sql);
    if (result.status !== 0) throw new Error(`[${current}] SQL failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  };
  const json = (sql) => JSON.parse(q(sql));
  const fails = (sql, state, message) => {
    const result = run(sql);
    assert.notEqual(result.status, 0, `[${current}] expected ${state}, the command succeeded`);
    const sqlstate = /ERROR:\s+([0-9A-Z]{5}):/.exec(result.stderr)?.[1];
    assert.equal(sqlstate, state, `[${current}] ${result.stderr}`);
    if (message) assert.match(result.stderr, message, `[${current}] ${result.stderr}`);
    return result.stderr;
  };
  const claims = (user) => ({
    sub: user.id,
    role: "authenticated",
    session_id: user.session,
    aal: "aal1",
    is_anonymous: false,
  });
  const as = (payload, sql) =>
    `\\o /dev/null\nselect set_config('request.jwt.claim.sub','${payload.sub}',false),set_config('request.jwt.claims','${JSON.stringify(payload)}',false);\n\\o\nset role authenticated;\n${sql}`;
  const member = (user, sql) => as(claims(user), sql);
  const staff = (user, sql) =>
    as(
      {
        ...claims(user),
        aal: "aal2",
        amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }],
      },
      sql
    );
  const service = (sql) => `set role service_role;\n${sql}`;
  const anon = (sql) => `set role anon;\n${sql}`;
  const fingerprint = () => q(`set search_path to pg_catalog;\n${FINGERPRINT}`);
  const preflight = () =>
    q(PREFLIGHT)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|"));
  const hex = (bytes) => randomBytes(bytes).toString("hex");

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
  /** The website's server completing an upload; `extra` is SQL for the
   * optional arguments (named), exactly as PostgREST passes them. */
  const completeSql = (owner, request, purpose, extra = "") =>
    service(
      `select api.complete_frontend_verification_upload(p_owner=>'${owner.id}',p_request=>'${request}',` +
        `p_stored_sha256=>'${hex(32)}',p_content_sha256=>'${hex(32)}',p_size=>128,` +
        (purpose === "id_front"
          ? `p_identity=>'${JSON.stringify(identityReceipt())}'::jsonb`
          : "p_risk_score=>10") +
        `${extra});`
    );
  /** ID and selfie of a new member through the production upload commands.
   * Returns the member, the case and the selfie's receipt. */
  const submit = (label, extra = "") => {
    const owner = user(label);
    const id = reserve(owner, "id_front");
    q(completeSql(owner, id.request, "id_front"));
    const selfie = reserve(owner, "selfie");
    const done = json(completeSql(owner, selfie.request, "selfie", extra));
    assert.deepEqual(done, { completed: true, artifact_id: selfie.artifact, purpose: "selfie" });
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
  const lease = (caseId) => json(staff(reviewer, `select api.claim_evidence_case('${caseId}');`));
  const readCapture = (caseId, held, who = reviewer) =>
    staff(
      who,
      `select api.get_frontend_staff_selfie_capture('${caseId}','${held.claim_generation}','${held.claim_nonce}');`
    );
  const bodyOf = (sig) =>
    q(
      `select coalesce((select md5(replace(prosrc,E'\\r\\n',E'\\n')) from pg_proc where oid=to_regprocedure('${sig}')),'missing');`
    );

  // ------------------------------------------------------------ before
  let early;
  await check("before the update: uploads complete without a capture report", () => {
    assert.equal(bodyOf(`internal.complete_frontend_verification_upload${OLD}`).length, 32);
    assert.equal(bodyOf(`internal.complete_frontend_verification_upload${NEW}`), "missing");
    early = submit("early");
    // The website's new arguments are unknown to the database before the update.
    fails(
      completeSql(
        early.owner,
        randomUUID(),
        "selfie",
        ",p_capture_method=>'camera',p_browser_liveness_passed=>true"
      ),
      "42883"
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
      /^selfie capture method: reviewed bodies, update not applied \(apply before the website release that sends these values is deployed\); selfie receipts: [1-9]\d*; with a capture method: 0$/
    );
    const write = database.psql(`${PREFLIGHT}\ncreate table vmtest.marker(id uuid);`, [
      "-A",
      "-t",
      "-1",
      "-v",
      "VERBOSITY=verbose",
    ]);
    assert.notEqual(write.status, 0);
    assert.match(write.stderr, /ERROR:\s+25006:/);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    for (const sig of [
      `internal.complete_frontend_verification_upload${OLD}`,
      `api.complete_frontend_verification_upload${OLD}`,
    ]) {
      const live = q(`select pg_get_functiondef('${sig}'::regprocedure);`);
      // The same function with one more space at the start of its body.
      q(
        `do $$begin execute replace(pg_get_functiondef('${sig}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
      );
      const rows = preflight();
      assert.equal(rows.length, 2, JSON.stringify(rows));
      assert.match(rows[1][1], /is not the reviewed body/);
      assert.match(fails(step.sql, "55000"), /upload completion drift/);
      q(`${live};`);
    }
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  const before = fingerprint();
  applySteps(database, [step]);
  const after = fingerprint();
  let uploaded, live, unverified, silent;
  await check("the selfie's capture report is stored with the case", () => {
    assert.notEqual(after, before);
    assert.equal(bodyOf(`internal.complete_frontend_verification_upload${OLD}`), "missing");
    assert.equal(bodyOf(`api.complete_frontend_verification_upload${OLD}`), "missing");
    assert.match(preflight()[0][1], /^selfie capture method: already applied; /);
    assert.equal(preflight().length, 1);
    uploaded = submit(
      "uploaded",
      ",p_capture_method=>'file_upload',p_browser_liveness_passed=>false"
    );
    live = submit("live", ",p_capture_method=>'camera',p_browser_liveness_passed=>true");
    unverified = submit(
      "unverified",
      ",p_capture_method=>'camera',p_browser_liveness_passed=>false"
    );
    // The website deployed before the update leaves both out.
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
    assert.deepEqual(stored(silent.selfie), {
      capture_method: null,
      browser_liveness_passed: null,
    });
    assert.deepEqual(stored(early.selfie), { capture_method: null, browser_liveness_passed: null });
    // The ID's receipt never carries one.
    assert.deepEqual(stored(uploaded.id), { capture_method: null, browser_liveness_passed: null });
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
  await check("a capture report outside the closed set is refused and stores nothing", () => {
    const owner = user("refused");
    const id = reserve(owner, "id_front");
    // Only a selfie carries a report.
    fails(
      completeSql(
        owner,
        id.request,
        "id_front",
        ",p_capture_method=>'file_upload',p_browser_liveness_passed=>false"
      ),
      "22023",
      /browser capture report invalid/
    );
    q(completeSql(owner, id.request, "id_front"));
    const selfie = reserve(owner, "selfie");
    for (const extra of [
      ",p_capture_method=>'screen',p_browser_liveness_passed=>false",
      ",p_capture_method=>'file_upload',p_browser_liveness_passed=>true",
      ",p_capture_method=>'camera'",
      ",p_browser_liveness_passed=>true",
      ",p_capture_method=>'Camera',p_browser_liveness_passed=>false",
    ])
      fails(
        completeSql(owner, selfie.request, "selfie", extra),
        "22023",
        /browser capture report invalid/
      );
    assert.equal(
      q(
        `select count(*) from private.frontend_verification_uploads where owner_id='${owner.id}' and completed_at is not null;`
      ),
      "1"
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
  });
  await check("a retried completion keeps the first report", () => {
    const again = json(
      completeSql(
        uploaded.owner,
        uploaded.selfie.request,
        "selfie",
        ",p_capture_method=>'camera',p_browser_liveness_passed=>true"
      )
    );
    assert.deepEqual(again, {
      completed: true,
      artifact_id: uploaded.selfie.artifact,
      purpose: "selfie",
    });
    assert.deepEqual(stored(uploaded.selfie), {
      capture_method: "file_upload",
      browser_liveness_passed: false,
    });
  });
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
    const grants = json(`select jsonb_build_object(
      'read', (select jsonb_object_agg(r, has_function_privilege(r,'api.get_frontend_staff_selfie_capture${READ}','execute')) from unnest(array['anon','authenticated','service_role']) r),
      'complete', (select jsonb_object_agg(r, has_function_privilege(r,'api.complete_frontend_verification_upload${NEW}','execute')) from unnest(array['anon','authenticated','service_role']) r),
      'internal_complete', (select jsonb_object_agg(r, has_function_privilege(r,'internal.complete_frontend_verification_upload${NEW}','execute')) from unnest(array['anon','authenticated','service_role']) r),
      'definer', (select jsonb_object_agg(p.oid::regprocedure::text, p.prosecdef) from pg_proc p where p.proname in('complete_frontend_verification_upload','get_frontend_staff_selfie_capture')));`);
    assert.deepEqual(grants.read, { anon: false, authenticated: true, service_role: false });
    assert.deepEqual(grants.complete, { anon: false, authenticated: false, service_role: true });
    assert.deepEqual(grants.internal_complete, {
      anon: false,
      authenticated: false,
      service_role: true,
    });
    assert.deepEqual(grants.definer, {
      [`api.complete_frontend_verification_upload${NEW}`]: false,
      [`internal.complete_frontend_verification_upload${NEW}`]: true,
      [`api.get_frontend_staff_selfie_capture${READ}`]: false,
      [`internal.get_frontend_staff_selfie_capture${READ}`]: true,
    });
    // A member cannot complete an upload or write the report themselves.
    fails(
      member(
        live.owner,
        `select api.complete_frontend_verification_upload('${live.owner.id}','${randomUUID()}','${hex(32)}','${hex(32)}',128,null,10,'camera',true);`
      ),
      "42501"
    );
  });
  await check("the report is removed with the member's identity history", () => {
    // The identity history purge (internal.retention_verification, five years
    // after the account closed) deletes the submissions and then the evidence
    // records, in this order; the receipts, and the report with them, follow.
    const owner = unverified.owner.id;
    q(`begin;
      delete from private.identity_submission_names where owner_id='${owner}';
      delete from private.verification_current_submissions where case_id='${unverified.caseId}';
      delete from private.evidence_access_log where case_id='${unverified.caseId}';
      delete from private.verification_identity_submissions where owner_id='${owner}';
      delete from private.evidence_artifacts where owner_id='${owner}';
      commit;`);
    assert.equal(
      q(`select count(*) from private.frontend_verification_uploads where owner_id='${owner}';`),
      "0"
    );
  });
  await check("apply, roll back and apply again are clean", () => {
    applySteps(database, [{ label: "selfie capture rollback", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before, "the rollback leaves the pre-update schema");
    assert.equal(bodyOf(`internal.complete_frontend_verification_upload${NEW}`), "missing");
    assert.equal(bodyOf(`api.get_frontend_staff_selfie_capture${READ}`), "missing");
    assert.match(preflight()[0][1], /^selfie capture method: reviewed bodies, update not applied/);
    // The seven-argument completion works again after the rollback.
    submit("after-rollback");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
    const again = submit(
      "reapplied",
      ",p_capture_method=>'file_upload',p_browser_liveness_passed=>false"
    );
    assert.deepEqual(stored(again.selfie), {
      capture_method: "file_upload",
      browser_liveness_passed: false,
    });
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the stored reports and the staff read", () => {
      assert.deepEqual(stored(live.selfie), {
        capture_method: "camera",
        browser_liveness_passed: true,
      });
      assert.equal(json(readCapture(live.caseId, live.held)).capture_method, "camera");
    });
  }
} catch (error) {
  console.error(`FAIL ${current}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Selfie capture method checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
