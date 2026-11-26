#!/usr/bin/env node
// Behaviour checks for 20261126210022_business_check_retention.sql (launch
// checklist item 79): business-check details deleted 30 days after the
// decision and the check record 12 months after it ended, as the Privacy page
// says.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, with the synthetic world of the staff payment checks. Business checks
// are written as their flows leave them (as the database owner, triggers off),
// dated in the past; the retention sweep runs through the production command
// api.run_retention as `service_role`, as the website's retention job runs it.
//
// It shows that before the update a decided visit check cannot lose its
// address, checks the read-only preflight, a drifted body and a premature
// rollback, applies the update and proves apply -> rollback -> apply, then
// checks: day 29 keeps the details and day 31 clears them (a revocation counts
// from its own date); the sticker, its date and town, the CIPC sticker details,
// the outcome and the staff note survive; the record is kept 11 months after it
// ended and gone at 13; an open legal hold or fraud hold keeps everything; a
// second sweep changes nothing; who may run it is unchanged. Any later updates
// are applied at the end.
//
//   node --import tsx scripts/test-foundation-business-check-retention.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertReadOnlyPreflight } from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  functionBodyMd5,
  runTwoAdminUpdateCheck,
  sha,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261126210022_business_check_retention.sql";
const SIGNATURE = "internal.retention_verification(integer)";
const [REVIEWED, UPDATED] = [
  "56e4f71f0ad4ecb994e79ea9b0d695b8",
  "0121042302cb64dec7f7d1bcf81df0e0",
];
const OLD_RULE = "CHECK (seen_method <> 'visit'::text OR visit_address IS NOT NULL)";
const NEW_RULE =
  "CHECK (seen_method <> 'visit'::text OR visit_address IS NOT NULL OR decided_at IS NOT NULL)";
const ZEROS = "details due: 0; records due: 0; held: 0";
const NOT_APPLIED = new RegExp(`^business check retention: update not applied; ${ZEROS}$`);
const APPLIED = new RegExp(`^business check retention: already applied; ${ZEROS}$`);

const SETUP = { update: UPDATE, label: "bcr", title: "Business check retention" };
await runTwoAdminUpdateCheck(SETUP, async (run) => {
  const { database, check, kit, world, admin } = run;
  const { q, json, fails, service, preflight } = kit;
  /** Runs `sql` as the database owner with triggers off (the flows' side effects are not under test). */
  const asOwner = (sql) =>
    q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);
  const sweepSql = () => service("select api.run_retention(500);");
  const sweep = () => json(sweepSql()).verification;
  const count = (table, where) =>
    Number(q(`select count(*) from private.${table} where ${where};`));
  const ago = (interval) => `now()-interval '${interval}'`;
  const rule = () =>
    q(`select pg_get_constraintdef(oid,true) from pg_constraint
      where conrelid='private.frontend_business_checks'::regclass and conname='frontend_business_checks_check1';`);
  /** A deleted evidence file of `purpose` on case `caseId` (the clean-up already ran); its id. */
  const file = (owner, caseId, purpose) => {
    const id = randomUUID();
    asOwner(`insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key,state,deleted_at)
      values('${id}','${caseId}','${owner.id}','${purpose}','evidence/${caseId}/${id}','deleted',now());`);
    return id;
  };
  /**
   * A decided business check of `kind` ('seen' visit or 'cipc' through a
   * representative) for a new member, with every detail the Privacy page
   * names: decided `decided` ago, approved (sticker for 365 days) unless
   * `status` says otherwise, revoked `revoked` ago when given.
   */
  const businessCheck = (label, kind, { decided, status = "approved", revoked = null }) => {
    const owner = world.user(label);
    const business = world.post(owner, "business", "business");
    const id = randomUUID();
    const final = revoked ? "withdrawn" : status;
    const expires = final === "approved" ? `${ago(decided)}+interval '365 days'` : "null";
    asOwner(`insert into private.evidence_cases(id,subject_id,kind,status) values('${id}','${owner.id}','business','decided');
      insert into private.frontend_business_checks(id,business_id,owner_id,kind,status,seen_method,visit_address,available_slots,
          screenshots_consent_at,visit_report,report_by,report_at,reviewed_by,review_note,reason_code,public_city,
          decided_at,expires_at,revoked_at)
        values('${id}','${business}','${owner.id}','${kind}','${final}',
          ${kind === "seen" ? `'visit','12 Main Road, Empangeni',array['Monday morning'],${ago(decided)}` : "null,null,null,null"},
          ${kind === "seen" ? `'{"outcome":"seen","identityConfirmed":true,"signage":true,"productsSeen":"Fresh bread","premisesType":"shop","notes":"Owner met us at the door.","city":"Empangeni"}'` : "null"},
          '${admin.id}',${ago(decided)},'${admin.id}','Checked in person.','checked',
          ${kind === "seen" ? "'Empangeni'" : "null"},${ago(decided)},${expires},${revoked ? ago(revoked) : "null"});
      insert into private.frontend_business_check_messages(check_id,author_id,author_role,body)
        values('${id}','${admin.id}','staff','Please send a photo of the shop front.');`);
    if (kind === "seen") {
      const photo = file(owner, id, "business_visit_photo");
      asOwner(`insert into private.frontend_business_seen_photos(artifact_id,check_id,verifier_id,content_digest,mime,latitude,longitude)
        values('${photo}','${id}','${admin.id}','${sha(photo)}','image/jpeg',-28.74521,31.89312);`);
    } else {
      const pdf = file(owner, id, "registration");
      asOwner(`insert into private.frontend_cipc_reviews(check_id,registration_number,route,submitted_at,owner_file,registered_name,
          accepted_role,position_title,registered_office,representative_email,representative_position,representative_verified_at,
          domain_confirmed,callback_confirmed,callback_record)
        values('${id}','2020/123456/07','representative',${ago(decided)},'${pdf}','Fixture Bakery (Pty) Ltd','representative',
          'Manager','{"suburb":"Meerensee","city":"Richards Bay","province":"KwaZulu-Natal"}','manager@fixture-bakery.example',
          'Manager',${ago(decided)},true,true,'{"numberSource":"Company website","spokeTo":"Reception","confirmedPosition":"Manager","confirmed":true,"notes":"Confirmed by phone."}');
        insert into private.frontend_cipc_documents(artifact_id,check_id,actor_id,source,content_digest,reviewed_version,summary,recorded_at)
        values('${pdf}','${id}','${owner.id}','owner_upload','${sha(pdf)}',now(),
          '{"registrationNumber":"2020/123456/07","registeredName":"Fixture Bakery (Pty) Ltd","directors":[{"name":"Thando Dlamini"}]}',now());`);
    }
    return { id, owner, business };
  };
  /** What the Privacy page says goes after 30 days, still held by check `id`. */
  const details = (id) => ({
    visit: Number(
      q(`select (visit_address is not null)::int+(visit_report is not null)::int
      from private.frontend_business_checks where id='${id}';`)
    ),
    photoLocations: count(
      "frontend_business_seen_photos",
      `check_id='${id}' and latitude is not null`
    ),
    messages: count("frontend_business_check_messages", `check_id='${id}'`),
    cipcDocuments: count("frontend_cipc_documents", `check_id='${id}'`),
    representative: count(
      "frontend_cipc_reviews",
      `check_id='${id}' and (representative_email is not null or callback_record is not null)`
    ),
  });
  const cleared = { visit: 0, photoLocations: 0, messages: 0, cipcDocuments: 0, representative: 0 };
  const seenFull = {
    visit: 2,
    photoLocations: 1,
    messages: 1,
    cipcDocuments: 0,
    representative: 0,
  };
  const cipcFull = {
    visit: 0,
    photoLocations: 0,
    messages: 1,
    cipcDocuments: 1,
    representative: 1,
  };
  /** The sticker and outcome fields that stay until the record goes. */
  const sticker = (id) =>
    q(`select concat_ws('|',x.status,x.seen_method,x.decided_at is not null,x.expires_at is not null,x.public_city,
        x.reason_code,x.review_note,r.registration_number,r.registered_name,r.accepted_role,r.position_title,
        r.registered_office->>'city',
        (select count(*) from private.frontend_business_seen_photos p where p.check_id=x.id))
      from private.frontend_business_checks x left join private.frontend_cipc_reviews r on r.check_id=x.id
      where x.id='${id}';`);
  const exists = (id) => count("frontend_business_checks", `id='${id}'`) === 1;

  // ------------------------------------------------------------ before
  await check("before the update: a decided visit check cannot lose its address", () => {
    assert.equal(functionBodyMd5(kit, SIGNATURE), REVIEWED);
    assert.equal(rule(), OLD_RULE);
    const { id } = businessCheck("bcr-before", "seen", { decided: "40 days" });
    fails(
      `update private.frontend_business_checks set visit_address=null where id='${id}';`,
      "23514",
      /frontend_business_checks_check1/
    );
    sweep();
    assert.deepEqual(details(id), seenFull, "the earlier sweep keeps every detail");
    asOwner(`delete from private.frontend_business_checks where id='${id}';
      delete from private.evidence_artifacts where case_id='${id}';
      delete from private.evidence_cases where id='${id}';`);
  });
  await check(
    "preflight (read only, one summary row); a premature rollback and drift refused",
    () => {
      const [summary, ...problems] = preflight();
      assert.deepEqual(problems, []);
      assert.match(summary[1], NOT_APPLIED);
      assertReadOnlyPreflight(database, kit.preflightSql);
      assertDriftRefused(kit, {
        label: "business check retention",
        signatures: [SIGNATURE],
        rows: 2,
      });
    }
  );

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "business check retention",
    applied: APPLIED,
    notApplied: NOT_APPLIED,
  });

  // ------------------------------------------------------------- after
  await check("the update's body and rule are installed", () => {
    assert.equal(functionBodyMd5(kit, SIGNATURE), UPDATED);
    assert.equal(rule(), NEW_RULE);
    // An undecided visit check still needs its address.
    const owner = world.user("bcr-open");
    const business = world.post(owner, "business", "business");
    const id = randomUUID();
    fails(
      `begin;
       insert into private.evidence_cases(id,subject_id,kind) values('${id}','${owner.id}','business');
       insert into private.frontend_business_checks(id,business_id,owner_id,kind,seen_method,available_slots,screenshots_consent_at)
         values('${id}','${business}','${owner.id}','seen','visit',array['Monday morning'],now());
       commit;`,
      "23514",
      /frontend_business_checks_check1/
    );
  });

  await check("day 29 keeps the details, day 31 clears them; the sticker stays", () => {
    const seen29 = businessCheck("bcr-seen29", "seen", { decided: "29 days" });
    const seen31 = businessCheck("bcr-seen31", "seen", { decided: "31 days" });
    const cipc29 = businessCheck("bcr-cipc29", "cipc", { decided: "29 days" });
    const cipc31 = businessCheck("bcr-cipc31", "cipc", { decided: "31 days" });
    const refused = businessCheck("bcr-refused31", "seen", {
      decided: "31 days",
      status: "rejected",
    });
    const before = [seen31, cipc31, refused].map(({ id }) => sticker(id));
    const result = sweep();
    assert.equal(result.business_check_details, 3, JSON.stringify(result));
    assert.equal(result.business_checks, 0, JSON.stringify(result));
    assert.deepEqual(details(seen29.id), seenFull);
    assert.deepEqual(details(cipc29.id), cipcFull);
    for (const { id } of [seen31, cipc31, refused]) assert.deepEqual(details(id), cleared, id);
    // The sticker (method, dates, town), the CIPC sticker details, the outcome
    // and the staff note survive; so do the photo rows (without locations).
    assert.deepEqual(
      [seen31, cipc31, refused].map(({ id }) => sticker(id)),
      before
    );
    assert.equal(sticker(seen31.id), "approved|visit|t|t|Empangeni|checked|Checked in person.|1");
    assert.equal(
      sticker(cipc31.id),
      "approved|t|t|checked|Checked in person.|2020/123456/07|Fixture Bakery (Pty) Ltd|representative|Manager|Richards Bay|0"
    );
    // The files' records are untouched; their deletion is the clean-up's job.
    assert.equal(count("evidence_artifacts", `case_id='${seen31.id}'`), 1);
  });

  await check("a revocation counts from its own date", () => {
    const recent = businessCheck("bcr-revoked10", "seen", {
      decided: "60 days",
      revoked: "10 days",
    });
    const old = businessCheck("bcr-revoked31", "seen", { decided: "90 days", revoked: "31 days" });
    const result = sweep();
    assert.equal(result.business_check_details, 1, JSON.stringify(result));
    assert.deepEqual(details(recent.id), seenFull);
    assert.deepEqual(details(old.id), cleared);
  });

  await check("the record goes 12 months after it ended, not before", () => {
    // A sticker runs 365 days from the approval.
    const ended11 = businessCheck("bcr-ended11", "cipc", { decided: "365 days 11 months" });
    const ended13 = businessCheck("bcr-ended13", "cipc", { decided: "365 days 13 months" });
    const refused11 = businessCheck("bcr-refused11", "seen", {
      decided: "11 months",
      status: "rejected",
    });
    const refused13 = businessCheck("bcr-refused13", "seen", {
      decided: "13 months",
      status: "rejected",
    });
    const revoked13 = businessCheck("bcr-revoked13", "seen", {
      decided: "14 months",
      revoked: "13 months",
    });
    const result = sweep();
    assert.equal(result.business_checks, 3, JSON.stringify(result));
    assert.equal(result.business_check_details, 2, JSON.stringify(result));
    for (const { id } of [ended11, refused11]) {
      assert.ok(exists(id), id);
      assert.deepEqual(details(id), cleared, id);
    }
    for (const { id } of [ended13, refused13, revoked13]) {
      assert.ok(!exists(id), id);
      for (const table of [
        "frontend_cipc_reviews",
        "frontend_business_seen_photos",
        "frontend_business_check_messages",
      ])
        assert.equal(count(table, `check_id='${id}'`), 0, `${table} ${id}`);
      // The case shell stays closed for the five-year sweep of closed accounts.
      assert.equal(q(`select status from private.evidence_cases where id='${id}';`), "decided");
    }
  });

  await check("an open legal hold or fraud hold keeps everything", () => {
    const legal = businessCheck("bcr-legal", "seen", { decided: "31 days" });
    const legalOld = businessCheck("bcr-legal-old", "cipc", { decided: "365 days 13 months" });
    const fraud = businessCheck("bcr-fraud", "cipc", { decided: "31 days" });
    const fraudOld = businessCheck("bcr-fraud-old", "seen", {
      decided: "13 months",
      status: "rejected",
    });
    asOwner(`insert into private.legal_holds(subject_id,reason,placed_by)
        values('${legal.owner.id}','Court order pending.','${admin.id}'),('${legalOld.owner.id}','Court order pending.','${admin.id}');
      insert into private.evidence_fraud_holds(case_id,reason,placed_by)
        values('${fraud.id}','Possible forged CIPC document.','${admin.id}'),('${fraudOld.id}','Possible forged CIPC document.','${admin.id}');`);
    assert.match(preflight()[0][1], /; details due: 0; records due: 0; held: 4$/);
    const result = sweep();
    assert.equal(result.business_check_details, 0, JSON.stringify(result));
    assert.equal(result.business_checks, 0, JSON.stringify(result));
    assert.deepEqual(details(legal.id), seenFull);
    assert.deepEqual(details(fraud.id), cipcFull);
    assert.ok(exists(legalOld.id) && exists(fraudOld.id));
    // A released or closed hold lets the next sweep act.
    asOwner(`update private.legal_holds set released_at=now(),released_by='${admin.id}'
        where subject_id in('${legal.owner.id}','${legalOld.owner.id}');
      update private.evidence_fraud_holds set closed_at=now(),closed_by='${admin.id}',close_reason='Checked: genuine.'
        where case_id='${fraud.id}';`);
    assert.match(preflight()[0][1], /; details due: 2; records due: 1; held: 1$/);
    const next = sweep();
    assert.equal(next.business_check_details, 2, JSON.stringify(next));
    assert.equal(next.business_checks, 1, JSON.stringify(next));
    assert.deepEqual(details(legal.id), cleared);
    assert.deepEqual(details(fraud.id), cleared);
    assert.ok(!exists(legalOld.id));
    assert.ok(exists(fraudOld.id), "its fraud hold is still open");
  });

  await check("running the sweep twice is safe", () => {
    businessCheck("bcr-twice", "seen", { decided: "31 days" });
    businessCheck("bcr-twice-old", "cipc", { decided: "365 days 13 months" });
    const first = sweep();
    assert.equal(first.business_check_details, 1, JSON.stringify(first));
    assert.equal(first.business_checks, 1, JSON.stringify(first));
    const state =
      q(`select string_agg(concat_ws(':',id,status,visit_address,visit_report::text,updated_at),',' order by id)
      from private.frontend_business_checks;`);
    const second = sweep();
    assert.equal(second.business_check_details, 0, JSON.stringify(second));
    assert.equal(second.business_checks, 0, JSON.stringify(second));
    assert.equal(
      q(`select string_agg(concat_ws(':',id,status,visit_address,visit_report::text,updated_at),',' order by id)
        from private.frontend_business_checks;`),
      state
    );
    assert.match(preflight()[0][1], /; details due: 0; records due: 0; held: 1$/);
  });

  await check("who may run the sweep is unchanged", () => {
    const member = world.user("bcr-caller");
    fails(kit.member(member, "select api.run_retention(10);"), "42501");
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        q(`select has_function_privilege('${role}','${SIGNATURE}','execute');`),
        "f",
        role
      );
  });

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the business check retention", () => {
      const { id } = businessCheck("bcr-later", "seen", { decided: "31 days" });
      assert.equal(sweep().business_check_details, 1);
      assert.deepEqual(details(id), cleared);
    });
  }
});
