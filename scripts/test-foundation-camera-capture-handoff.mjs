#!/usr/bin/env node
// Behaviour checks for 20261120131212_camera_capture_handoff.sql: "Continue
// on your phone" links (single use, 15 minutes, bound to one account, its open
// identity case and the computer's live session, capture only) and the refusal
// of selfies the browser says were uploaded files.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members call as `authenticated` with synthetic claims and a live
// session row; the website's server calls as `service_role`. The script runs
// the update's read-only preflight, checks its refusals, applies it, checks
// the rules, and proves apply -> rollback -> apply returns the same
// fingerprints. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-camera-capture-handoff.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Token
// and grant hashes, evidence hashes and the encrypted ID number receipt are
// synthetic; no object storage is involved.
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
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261120131212_camera_capture_handoff.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const RECORD = "internal.record_my_selfie_capture(uuid,text,boolean)";
const RETENTION = "internal.run_retention(integer)";
const START = "start_capture_handoff(text,text,text,jsonb)";
const REDEEM = "redeem_capture_handoff(text,text,uuid)";
const CONTEXT = "capture_handoff_context(text)";
const RESERVE = "reserve_handoff_verification_upload(text,uuid,text,text,boolean)";

const {
  started,
  database,
  check,
  current,
  passed: checks,
  q,
  json,
  fails,
  claims,
  as,
  member,
  service,
  fingerprint,
  bodyMd5,
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const hex = (bytes) => randomBytes(bytes).toString("hex");
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const anon = (sql) => `set role anon;\n${sql}`;
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
  /** The signed-in website path: reserve with the member's session. */
  const reserve = (owner, purpose) => {
    const request = randomUUID();
    const names = purpose === "id_front" ? ",'Thando Sipho','Dlamini'" : "";
    const reserved = json(
      member(
        owner,
        `select api.reserve_frontend_verification_upload('${request}','${purpose}','${hex(32)}'${names});`
      )
    );
    return { request, artifact: reserved.artifact_id };
  };
  /** The website's server completing an upload (unchanged by the update). */
  const complete = (owner, request, purpose, identity = identityReceipt()) =>
    json(
      service(
        `select api.complete_frontend_verification_upload('${owner.id}','${request}','${hex(32)}','${hex(32)}',128,` +
          (purpose === "id_front" ? `${sqlJsonb(identity)},null);` : "null,10);")
      )
    );
  const recordSql = (owner, request, method, passed) =>
    member(owner, `select api.record_my_selfie_capture('${request}','${method}',${passed});`);
  const startSql = (
    owner,
    token,
    identity = identityReceipt(),
    names = ["Thando Sipho", "Dlamini"]
  ) =>
    member(
      owner,
      identity
        ? `select api.start_capture_handoff('${sha(token)}','${names[0]}','${names[1]}',${sqlJsonb(identity)});`
        : `select api.start_capture_handoff('${sha(token)}');`
    );
  const redeemSql = (token, grant, signedIn = null) =>
    service(
      `select api.redeem_capture_handoff('${sha(token)}','${sha(grant)}',${signedIn ? `'${signedIn}'` : "null"});`
    );
  const contextSql = (grant) => service(`select api.capture_handoff_context('${sha(grant)}');`);
  const reserveSql = (
    grant,
    request,
    purpose,
    passed = purpose === "selfie" ? true : null,
    digest = hex(32)
  ) =>
    service(
      `select api.reserve_handoff_verification_upload('${sha(grant)}','${request}','${purpose}','${digest}',${passed});`
    );
  /** A member with a link made on the computer and opened on the phone. */
  const linked = (label, identity = identityReceipt()) => {
    const owner = syntheticMember(label);
    const token = `token-${randomUUID()}`;
    const grant = `grant-${randomUUID()}`;
    json(startSql(owner, token, identity));
    const state = json(redeemSql(token, grant));
    return { owner, token, grant, identity, state };
  };
  const row = (owner) =>
    json(`select coalesce((select to_jsonb(h) from private.capture_handoffs h where owner_id='${owner.id}'
      order by created_at desc limit 1),'null');`);
  const age = (owner, interval) =>
    q(`update private.capture_handoffs set created_at=created_at-interval '${interval}',
      expires_at=expires_at-interval '${interval}' where owner_id='${owner.id}';`);

  // ------------------------------------------------------------ before
  await check("before the update: no phone links, and an uploaded selfie is recorded", () => {
    assert.equal(bodyMd5(RECORD), "4ad4bbe1cfe3f8276dfd73e113c34f2f");
    assert.equal(bodyMd5(RETENTION), "95dda89b3f540a74110a0ca1eba02e66");
    assert.equal(q(`select to_regclass('private.capture_handoffs') is null;`), "t");
    const owner = syntheticMember("before");
    complete(owner, reserve(owner, "id_front").request, "id_front");
    const selfie = reserve(owner, "selfie");
    assert.deepEqual(json(recordSql(owner, selfie.request, "file_upload", false)), {
      recorded: true,
    });
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
      "camera capture handoff: update not applied; selfies said to be uploaded files: 1"
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () =>
    assertDriftRefused(
      { q, fails, fingerprint, preflightRows: preflight },
      {
        rollback: ROLLBACK,
        updateSql: step.sql,
        signatures: [RECORD, RETENTION],
        drift: /camera capture handoff drift/,
      }
    )
  );

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "camera capture handoff",
    fingerprint,
    preflightRows: preflight,
    appliedSummary:
      /^camera capture handoff: already applied; selfies said to be uploaded files: 1; phone links: 0$/,
  });

  await check("a selfie said to be an uploaded file is refused; earlier answers stay", () => {
    const owner = syntheticMember("camera-only");
    complete(owner, reserve(owner, "id_front").request, "id_front");
    const selfie = reserve(owner, "selfie");
    const stderr = fails(
      recordSql(owner, selfie.request, "file_upload", false),
      "PT409",
      /camera required/
    );
    assert.equal(/^DETAIL:\s+(\S+)/m.exec(stderr)?.[1], "camera_required", stderr);
    // The closed set is still checked first.
    fails(
      recordSql(owner, selfie.request, "screen", false),
      "22023",
      /browser capture report invalid/
    );
    assert.deepEqual(json(recordSql(owner, selfie.request, "camera", true)), { recorded: true });
    assert.equal(
      q(
        `select count(*) from private.frontend_verification_uploads where capture_method='file_upload';`
      ),
      "1"
    );
  });

  let main;
  await check("the computer makes a link: hashed, 15 minutes, its case and session", () => {
    const owner = syntheticMember("handoff");
    const token = `token-${randomUUID()}`;
    const identity = identityReceipt();
    const made = json(startSql(owner, token, identity));
    assert.equal(made.needs_id, true);
    const stored = row(owner);
    assert.equal(stored.token_sha256, sha(token));
    assert.equal(stored.session_id, owner.session);
    assert.equal(stored.used_at, null);
    assert.equal(stored.grant_sha256, null);
    assert.equal(stored.fingerprint, identity.fingerprint);
    assert.deepEqual(stored.encrypted_number, identity.encrypted_number);
    assert.equal(
      q(
        `select expires_at-created_at='15 minutes'::interval from private.capture_handoffs where owner_id='${owner.id}';`
      ),
      "t"
    );
    assert.equal(
      q(
        `select count(*) from private.evidence_cases where id='${stored.case_id}' and subject_id='${owner.id}' and status='open';`
      ),
      "1"
    );
    // The typed names are saved as the ID upload saves them.
    assert.equal(
      q(
        `select legal_first_name||'|'||legal_last_name from private.profiles where account_id='${owner.id}';`
      ),
      "Thando Sipho|Dlamini"
    );
    main = { owner, token, identity, case: stored.case_id };
  });
  await check(
    "making a link refuses bad input, missing ID details and a sixth link in an hour",
    () => {
      const owner = syntheticMember("refusals");
      fails(
        member(owner, `select api.start_capture_handoff('nothex');`),
        "22023",
        /phone link token required/
      );
      fails(
        member(owner, `select api.start_capture_handoff('${sha("x")}','Thando',null,null);`),
        "22023",
        /names and ID details come together/
      );
      fails(
        member(owner, `select api.start_capture_handoff('${sha("y")}','Thando','Dlamini',null);`),
        "22023",
        /names and ID details come together/
      );
      fails(
        startSql(owner, "z", { ...identityReceipt(), extra: 1 }),
        "22023",
        /encrypted identity receipt required/
      );
      // Without ID details, an ID photo of the open case must already be there.
      const stderr = fails(startSql(owner, "no-id", null), "PT409", /ID details required/);
      assert.equal(/^DETAIL:\s+(\S+)/m.exec(stderr)?.[1], "handoff_needs_id");
      for (let i = 0; i < 5; i += 1) json(startSql(owner, `rate-${i}`));
      const limited = fails(startSql(owner, "rate-6"), "PT429", /too many phone links/);
      assert.equal(/^DETAIL:\s+(\S+)/m.exec(limited)?.[1], "handoff_rate_limited");
      // A reused token is refused.
      const other = syntheticMember("reused");
      fails(startSql(other, "rate-0"), "PT409", /already used/);
      // Signed-out visitors, the service role and a session that is not live.
      fails(anon(`select api.start_capture_handoff('${sha("a")}');`), "42501");
      fails(service(`select api.start_capture_handoff('${sha("b")}');`), "42501");
      fails(
        as(
          { ...claims(other), session_id: randomUUID() },
          `select api.start_capture_handoff('${sha("c")}');`
        ),
        "42501"
      );
    }
  );
  await check(
    "the phone opens the link once; a phone signed in as another account is refused",
    () => {
      const grant = `grant-${randomUUID()}`;
      const stranger = syntheticMember("stranger");
      const other = fails(redeemSql(main.token, grant, stranger.id), "42501", /another account/);
      assert.equal(/^DETAIL:\s+(\S+)/m.exec(other)?.[1], "handoff_other_account");
      assert.equal(row(main.owner).used_at, null, "the refused phone did not use the link");
      const state = json(redeemSql(main.token, grant, main.owner.id));
      assert.deepEqual(Object.keys(state).sort(), [
        "expires_at",
        "needs_id",
        "needs_selfie",
        "owner_id",
        "public_name",
      ]);
      assert.equal(state.owner_id, main.owner.id);
      assert.equal(state.public_name, "Fixture h.");
      assert.equal(state.needs_id, true);
      assert.equal(state.needs_selfie, true);
      assert.equal(row(main.owner).grant_sha256, sha(grant));
      const used = fails(
        redeemSql(main.token, `grant-${randomUUID()}`),
        "PT409",
        /expired or already used/
      );
      assert.equal(/^DETAIL:\s+(\S+)/m.exec(used)?.[1], "handoff_unavailable");
      fails(
        redeemSql(`unknown-${randomUUID()}`, `grant-${randomUUID()}`),
        "PT409",
        /expired or already used/
      );
      fails(redeemSql(main.token, main.token), "22023");
      assert.deepEqual(json(contextSql(grant)), state);
      fails(contextSql(`grant-${randomUUID()}`), "PT409", /expired or replaced/);
      main.grant = grant;
    }
  );
  await check("the phone uploads the ID photo and the selfie for that case only", () => {
    const id = randomUUID();
    const digest = hex(32);
    const reserved = json(reserveSql(main.grant, id, "id_front", null, digest));
    assert.equal(reserved.completed, false);
    assert.deepEqual(reserved.identity, {
      fingerprint: main.identity.fingerprint,
      encrypted_number: main.identity.encrypted_number,
    });
    const upload = json(
      `select to_jsonb(u) from private.frontend_verification_uploads u where request_id='${id}';`
    );
    assert.equal(upload.owner_id, main.owner.id);
    assert.equal(upload.case_id, main.case);
    assert.equal(upload.session_id, main.owner.session);
    assert.equal(upload.capture_method, null);
    // A selfie needs the ID photo completed first.
    fails(reserveSql(main.grant, randomUUID(), "selfie"), "PT409", /upload the ID document first/);
    // The website's server finishes it with the existing service commands.
    assert.equal(complete(main.owner, id, "id_front", reserved.identity).completed, true);
    assert.equal(json(contextSql(main.grant)).needs_id, false);
    // The same request again is answered from the receipt; a changed one is refused.
    assert.equal(json(reserveSql(main.grant, id, "id_front", null, digest)).completed, true);
    fails(reserveSql(main.grant, id, "id_front"), "PT409", /upload request changed or expired/);
    fails(reserveSql(main.grant, randomUUID(), "selfie", null), "22023", /upload request required/);
    fails(
      reserveSql(main.grant, randomUUID(), "id_front", true),
      "22023",
      /upload request required/
    );
    const selfie = randomUUID();
    json(reserveSql(main.grant, selfie, "selfie", true));
    assert.equal(complete(main.owner, selfie, "selfie").completed, true);
    const stored =
      json(`select jsonb_build_object('m',capture_method,'l',browser_liveness_passed,'s',submission_id is not null)
      from private.frontend_verification_uploads where request_id='${selfie}';`);
    assert.deepEqual(stored, { m: "camera", l: true, s: true });
    assert.equal(
      q(
        `select count(*) from private.verification_current_submissions where case_id='${main.case}';`
      ),
      "1"
    );
    assert.equal(json(contextSql(main.grant)).needs_selfie, false);
  });
  await check("a link stops working when expired, replaced or signed out on the computer", () => {
    // Expired before it was opened.
    const late = syntheticMember("late");
    json(startSql(late, "late-token"));
    age(late, "15 minutes");
    fails(redeemSql("late-token", "late-grant"), "PT409", /expired or already used/);
    // Expired after it was opened.
    const opened = linked("opened");
    age(opened.owner, "15 minutes");
    fails(contextSql(opened.grant), "PT409", /expired or replaced/);
    fails(reserveSql(opened.grant, randomUUID(), "id_front"), "PT409", /expired or replaced/);
    // Replaced by a newer link: both the unopened and the opened one stop.
    const replaced = linked("replaced");
    json(startSql(replaced.owner, `newer-${randomUUID()}`));
    fails(contextSql(replaced.grant), "PT409", /expired or replaced/);
    const unopened = syntheticMember("unopened");
    json(startSql(unopened, "first-token"));
    json(startSql(unopened, "second-token"));
    fails(redeemSql("first-token", "first-grant"), "PT409");
    json(redeemSql("second-token", "second-grant"));
    // The computer signs out.
    const signedOut = linked("signed-out");
    q(
      `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${signedOut.owner.session}';`
    );
    fails(reserveSql(signedOut.grant, randomUUID(), "id_front"), "PT409", /expired or replaced/);
    // A closed account.
    const closed = linked("closed");
    q(
      `insert into private.account_closures(user_id,closed_at,evidence_delete_after) values('${closed.owner.id}',statement_timestamp(),statement_timestamp()+interval '90 days');`
    );
    fails(contextSql(closed.grant), "PT409", /expired or replaced/);
  });
  await check("a selfie-only link follows an ID photo taken on the computer", () => {
    const owner = syntheticMember("selfie-only");
    const id = reserve(owner, "id_front");
    complete(owner, id.request, "id_front");
    const made = json(startSql(owner, "selfie-token", null));
    assert.equal(made.needs_id, false);
    const state = json(redeemSql("selfie-token", "selfie-grant"));
    assert.equal(state.needs_id, false);
    assert.equal(state.needs_selfie, true);
    const refused = fails(
      reserveSql("selfie-grant", randomUUID(), "id_front"),
      "PT409",
      /ID details required/
    );
    assert.equal(/^DETAIL:\s+(\S+)/m.exec(refused)?.[1], "handoff_needs_id");
    const selfie = randomUUID();
    json(reserveSql("selfie-grant", selfie, "selfie", false));
    assert.equal(complete(owner, selfie, "selfie").completed, true);
  });
  await check("only the website's server opens links and reserves phone uploads", () => {
    const grants = executeGrants(json, [
      `api.${START}`,
      `internal.${START}`,
      `api.${REDEEM}`,
      `internal.${REDEEM}`,
      `api.${CONTEXT}`,
      `internal.${CONTEXT}`,
      `api.${RESERVE}`,
      `internal.${RESERVE}`,
      "internal.purge_capture_handoffs(integer)",
      "internal.capture_handoff_by_grant(text)",
      "internal.capture_handoff_prior_id(uuid,uuid)",
    ]);
    const memberOnly = { anon: false, authenticated: true, service_role: false };
    const server = { anon: false, authenticated: false, service_role: true };
    const nobody = { anon: false, authenticated: false, service_role: false };
    assert.deepEqual(grants, {
      [`api.${START}`]: memberOnly,
      [`internal.${START}`]: memberOnly,
      [`api.${REDEEM}`]: server,
      [`internal.${REDEEM}`]: server,
      [`api.${CONTEXT}`]: server,
      [`internal.${CONTEXT}`]: server,
      [`api.${RESERVE}`]: server,
      [`internal.${RESERVE}`]: server,
      "internal.purge_capture_handoffs(integer)": nobody,
      "internal.capture_handoff_by_grant(text)": nobody,
      "internal.capture_handoff_prior_id(uuid,uuid)": nobody,
    });
    for (const sql of [
      redeemSql("t", "g").replace("set role service_role;", ""),
      `select api.capture_handoff_context('${sha("g")}');`,
    ]) {
      fails(anon(sql), "42501");
      fails(member(main.owner, sql), "42501");
    }
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        q(
          `select has_table_privilege('${role}','private.capture_handoffs','select,insert,update,delete');`
        ),
        "f"
      );
    assert.equal(
      q(`select relrowsecurity from pg_class where oid='private.capture_handoffs'::regclass;`),
      "t"
    );
  });
  await check("links go one day after they expired", () => {
    const before = Number(q(`select count(*) from private.capture_handoffs;`));
    const old = syntheticMember("old-link");
    json(startSql(old, "old-token"));
    age(old, "1 day 16 minutes");
    const recent = syntheticMember("recent-link");
    json(startSql(recent, "recent-token"));
    age(recent, "1 day 14 minutes");
    const result = json(service(`select api.run_retention(100);`));
    assert.ok(result.capture_handoffs >= 1, JSON.stringify(result));
    assert.equal(row(old), null);
    assert.notEqual(row(recent), null);
    assert.ok(Number(q(`select count(*) from private.capture_handoffs;`)) <= before + 1);
    assert.match(preflight()[0][1], /; phone links: [1-9]\d*$/);
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the phone links working", () => {
      const again = linked("later");
      json(reserveSql(again.grant, randomUUID(), "id_front"));
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Camera capture handoff checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
