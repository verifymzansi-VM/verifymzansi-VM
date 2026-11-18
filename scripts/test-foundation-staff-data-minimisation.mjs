#!/usr/bin/env node
// Behaviour checks for 20261118072601_staff_data_minimisation.sql:
//
// 1. review queues and case summaries name a member by their public short
//    name; the full legal name only on the claimed, evidence:view (second
//    factor from the last 15 minutes), access-logged path; members see their
//    own name unchanged;
// 2. privacy (data) requests need two staff members (whoever recorded the
//    intake or checked the identity never approves, whoever approved never
//    checks the identity), export and completion need the approval, a request
//    started before the update is approved by a second staff member, and the
//    data subject is emailed and notified on approval and on the first export;
// 3. the support inbox needs a recent second factor and lists 12 months (older
//    tickets only while open);
// 4. the staff invoice and bank transfer reads need a recent second factor;
// 5. the organisation dashboard carries no applicant contacts and names
//    co-administrators by their short name; one pending applicant's contact is
//    revealed on request, never a decided or withdrawn one.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. The script runs the update's read-only preflight, checks its refusals,
// applies it, proves apply -> rollback -> apply returns the same fingerprints,
// then checks every rule through the production API commands as members, staff
// (synthetic sessions with a verified authenticator app) and the service role.
// Rows the commands read but that other commands own (ID check and business
// cases, support tickets, an organisation and its applications) are written as
// the database owner. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-staff-data-minimisation.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertReadOnlyPreflight,
  installStaffPaymentWorld,
  openUpdateCheck,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261118072601_staff_data_minimisation.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const SUPPORT_INBOX = "internal.get_frontend_support_inbox(integer,uuid)";
const RECENT = /recent second-factor verification required/;
const SECOND_PERSON = /second staff member/;

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
  preflightRows: preflight,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const count = (sql) => Number(q(`select count(*) from ${sql};`));
  const stale = () => Math.floor(Date.now() / 1000) - 20 * 60;

  // ------------------------------------------------------- synthetic world
  const { user, staffUser, verify } = installStaffPaymentWorld(q, json);
  const admin = staffUser("admin", "admin");
  const admin2 = staffUser("admin2", "admin");
  const governor = staffUser("governor", "governor");
  const moderator = staffUser("moderator", "moderator");
  /** A member with an accepted ID review whose name is `first last`, shown
   * in full as their display name (as an accepted review sets it). */
  const named = (label, first, last) => {
    const person = user(label);
    verify(person, admin, label);
    q(`set session_replication_role=replica;
      update private.profiles set display_name='${first} ${last}',legal_first_name='${first}',legal_last_name='${last}'
        where account_id='${person.id}';`);
    return person;
  };
  const thandeka = named("thandeka", "Thandeka", "Dlamini");
  q(`create function vmtest.live_event(p_owner uuid,p_phone text,p_email text) returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); begin
      perform set_config('session_replication_role','replica',true);
      insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id,
          status,published_at,visible_until)
        values(pid,p_owner,'event','tourism_events','events',(select a.key from private.category_activities a
          where a.category_key='events' order by a.key limit 1),'Fixture business '||left(pid::text,8),
          'A synthetic description long enough for every rule.','gp','gp_johannesburg','live',now()-interval '2 days',now()+interval '20 days');
      insert into private.event_details(post_id,starts_at,ends_at,timezone)
        values(pid,date_trunc('milliseconds',now()+interval '10 days'),date_trunc('milliseconds',now()+interval '20 days'),'Africa/Johannesburg');
      insert into private.post_presentations(post_id,data,contacts)
        values(pid,jsonb_build_object('email',p_email,'website','https://example.invalid/'||left(pid::text,8)),
          jsonb_build_object('phone',p_phone))
        on conflict(post_id) do update set data=excluded.data,contacts=excluded.contacts;
      perform set_config('session_replication_role','origin',true);
      return pid;
    end$$;
    create function vmtest.business_case(p_owner uuid,p_post uuid,p_kind text) returns uuid language plpgsql as $$
    declare cid uuid:=gen_random_uuid(); begin
      perform set_config('session_replication_role','replica',true);
      insert into private.evidence_cases(id,subject_id,kind) values(cid,p_owner,'business');
      insert into private.frontend_business_checks(id,business_id,owner_id,kind,seen_method,screenshots_consent_at,available_slots)
        values(cid,p_post,p_owner,p_kind,case when p_kind='seen' then 'video' end,
          case when p_kind='seen' then now() end,case when p_kind='seen' then array['Weekday mornings'] end);
      if p_kind='cipc' then
        insert into private.frontend_cipc_reviews(check_id,registration_number,route,submitted_at)
          values(cid,'2020/'||lpad((abs(hashtext(cid::text))%1000000)::text,6,'0')||'/07','director',now());
      end if;
      perform set_config('session_replication_role','origin',true);
      return cid;
    end$$;
    create function vmtest.kyc_case(p_owner uuid) returns uuid language plpgsql as $$
    declare cid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
      perform set_config('session_replication_role','replica',true);
      insert into private.evidence_cases(id,subject_id,kind) values(cid,p_owner,'kyc');
      insert into private.verification_identity_submissions(id,case_id,owner_id,case_version,id_artifact_id,selfie_artifact_id,
          identity_hmac,identity_key_id,number_ciphertext,number_iv,number_tag,encryption_key_id,receipt_id,recipe,risk_score)
        values(sid,cid,p_owner,1,gen_random_uuid(),gen_random_uuid(),rpad('fixture',42,'x')||'A','identity-match-v1',
          repeat('a',26),repeat('b',24),repeat('c',32),'identity-number-v1',gen_random_uuid(),'manual-id-selfie-v1',10);
      insert into private.verification_current_submissions(case_id,submission_id) values(cid,sid);
      perform set_config('session_replication_role','origin',true);
      return cid;
    end$$;
    create function vmtest.claim(p_case uuid,p_staff uuid) returns void language sql as $$
      update private.evidence_cases set claimed_by=p_staff,claim_expires_at=now()+interval '30 minutes',
        claim_nonce=gen_random_uuid(),claim_generation=claim_generation+1 where id=p_case;
    $$;`);
  const business = q(
    `select vmtest.live_event('${thandeka.id}','+27820000101','thandeka-shop@example.invalid');`
  );
  const kyc = q(`select vmtest.kyc_case('${thandeka.id}');`);
  const seen = q(`select vmtest.business_case('${thandeka.id}','${business}','seen');`);
  const cipc = q(`select vmtest.business_case('${thandeka.id}','${business}','cipc');`);
  const queueOf = (who) =>
    json(staff(who, "select api.get_frontend_staff_verification_queue(100,'{}');"));

  // ------------------------------------------------------------ before
  await check("before the update: the ID check queue shows the full legal name", () => {
    const row = queueOf(moderator).groups.find((g) => g.case_id === kyc);
    assert.equal(row.display_name, "Thandeka Dlamini");
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
      "staff data minimisation: update not applied; privacy requests in progress or completed without a second approval: 0; resolved support tickets older than 12 months: 0"
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    const live = q(`select pg_get_functiondef('${SUPPORT_INBOX}'::regprocedure);`);
    q(
      `do $$begin execute replace(pg_get_functiondef('${SUPPORT_INBOX}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[0][1], /unexpected bodies/);
    assert.match(rows[1][1], /get_frontend_support_inbox.* is not the reviewed body/);
    assert.match(fails(step.sql, "55000"), /staff data minimisation drift/);
    q(`${live};`);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "staff data minimisation",
    fingerprint,
    preflightRows: preflight,
    appliedSummary:
      /^staff data minimisation: already applied; privacy requests in progress or completed without a second approval: 0; resolved support tickets older than 12 months: 0$/,
  });

  // ---------------------------------------------------------- 1. names
  const noFullName = (value, label) =>
    assert.equal(JSON.stringify(value).includes("Dlamini"), false, label);
  await check("ID check queues show the member's short name", () => {
    const row = queueOf(moderator).groups.find((g) => g.case_id === kyc);
    assert.equal(row.display_name, "Thandeka D.");
    noFullName(queueOf(moderator), "frontend queue");
    const older = json(staff(moderator, "select api.staff_verification_queue(100);"));
    assert.equal(older.find((r) => r.case_id === kyc).display_name, "Thandeka D.");
    noFullName(older, "older queue");
  });
  await check("business review queues show the owner's short name", () => {
    const visits = json(staff(moderator, "select api.get_frontend_seen_queue('visits');"));
    assert.equal(visits.rows.find((r) => r.id === seen).ownerName, "Thandeka D.");
    noFullName(visits, "seen queue");
    const review = json(
      staff(moderator, "select api.get_frontend_business_review_queue('review');")
    );
    assert.equal(review.rows.find((r) => r.id === cipc).ownerName, "Thandeka D.");
    noFullName(review, "business review queue");
    const visitsTab = json(
      staff(moderator, "select api.get_frontend_business_review_queue('visits');")
    );
    assert.equal(visitsTab.rows.find((r) => r.id === seen).ownerName, "Thandeka D.");
  });
  await check("an unclaimed case shows the short name and no legal name", () => {
    for (const [command, id] of [
      ["get_frontend_seen_case", seen],
      ["get_frontend_cipc_case", cipc],
    ]) {
      const read = json(staff(moderator, `select api.${command}('${id}');`));
      assert.equal(read.owner.displayName, "Thandeka D.", command);
      assert.equal(read.owner.legalName, null, command);
      noFullName(read, command);
    }
    assert.equal(count(`private.evidence_access_log where case_id in('${seen}','${cipc}')`), 0);
  });
  await check("the full legal name only on the claimed, recent, logged path", () => {
    for (const [command, id] of [
      ["get_frontend_seen_case", seen],
      ["get_frontend_cipc_case", cipc],
    ]) {
      q(`select vmtest.claim('${id}','${moderator.id}');`);
      fails(staff(moderator, `select api.${command}('${id}');`, stale()), "42501", RECENT);
      assert.equal(count(`private.evidence_access_log where case_id='${id}'`), 0, command);
      const read = json(staff(moderator, `select api.${command}('${id}');`));
      assert.equal(read.owner.legalName, "Thandeka Dlamini", command);
      assert.equal(read.owner.displayName, "Thandeka D.", command);
      assert.equal(
        count(`private.evidence_access_log where case_id='${id}' and staff_id='${moderator.id}'`),
        1,
        command
      );
      // Another staff member who does not hold the case sees the short name.
      const other = json(staff(governor, `select api.${command}('${id}');`));
      assert.equal(other.owner.legalName, null, command);
    }
  });
  await check("members see their own name unchanged", () => {
    const own = json(member(thandeka, "select api.get_my_profile();"));
    assert.ok(JSON.stringify(own).includes('"Thandeka Dlamini"'), JSON.stringify(own));
  });

  // ------------------------------------------------- 2. privacy requests
  const privacy = (id) =>
    json(`select to_jsonb(r) from private.privacy_requests r where r.id='${id}';`);
  const record = (who) =>
    json(
      service(
        `select api.record_frontend_privacy_request('${who.id}','${who.session}','access','Fixture Member','0123','Synthetic access request ${crypto.randomUUID()}');`
      )
    ).id;
  const act = (who, id, action, totpAt) =>
    staff(
      who,
      `select api.process_frontend_privacy_request('${id}',${privacy(id).revision},'${action}');`,
      totpAt
    );
  const exportAs = (who, id) =>
    staff(who, `select api.export_frontend_privacy_request('${id}',${privacy(id).revision});`);
  const jobs = (id) =>
    q(
      `select coalesce(string_agg(kind,',' order by created_at,kind),'') from private.privacy_notice_jobs where request_id='${id}';`
    );
  const notices = (who, kind) =>
    count(`private.notifications where account_id='${who.id}' and kind='${kind}'`);

  await check("privacy: one staff member cannot approve and export alone", () => {
    const requester = named("lerato", "Lerato", "Mokoena");
    // Verified first: the verifier cannot approve.
    const first = record(requester);
    q(act(admin, first, "verify_identity"));
    fails(act(admin, first, "approve"), "42501", SECOND_PERSON);
    assert.equal(privacy(first).status, "submitted");
    fails(exportAs(admin, first), "PT409", /represented verified access request required/);
    // Approved first: the approver cannot check the identity.
    const second = record(requester);
    q(act(admin, second, "approve"));
    fails(act(admin, second, "verify_identity"), "42501", SECOND_PERSON);
    assert.equal(privacy(second).identity_verified, false);
    fails(exportAs(admin, second), "PT409", /represented verified access request required/);
    // Recorded by staff: whoever recorded the intake cannot approve.
    const email = q(`select email from auth.users where id='${requester.id}';`);
    const intake = json(
      staff(
        admin,
        `select api.record_frontend_privacy_intake('access','${email}',null,'Emailed access request','Recorded from the privacy mailbox');`
      )
    ).id;
    fails(act(admin, intake, "approve"), "42501", SECOND_PERSON);
    // The approval needs a second factor from the last 15 minutes (dsar:manage).
    fails(act(admin2, first, "approve", stale()), "42501", RECENT);
  });
  await check("privacy: a second staff member approves; the subject is told once each", () => {
    const requester = named("sizwe", "Sizwe", "Khumalo");
    const id = record(requester);
    q(act(admin, id, "verify_identity"));
    assert.equal(json(act(admin2, id, "approve")).status, "in_progress");
    const approved = privacy(id);
    assert.equal(approved.approved_by, admin2.id);
    assert.ok(approved.approved_at);
    assert.equal(jobs(id), "submitted,approved");
    assert.equal(notices(requester, "privacy_request_approved"), 1);
    // The queue says who may approve (nobody now) and when it was approved.
    const item = json(staff(admin, "select api.get_frontend_privacy_queue('open',1);")).items.find(
      (r) => r.id === id
    );
    assert.equal(item.may_approve, false);
    assert.ok(item.approved_at);
    // Either of the two exports; the subject is told of the first export only.
    const exported = json(exportAs(admin, id));
    assert.equal(exported.request_id, id);
    json(exportAs(admin2, id));
    assert.equal(jobs(id), "submitted,approved,exported");
    assert.equal(notices(requester, "privacy_export_made"), 1);
    const bell = json(member(requester, "select api.list_my_frontend_notices(50,false,null);"));
    const kinds = bell.items.map((n) => n.kind);
    assert.ok(kinds.includes("privacy_request_approved"), JSON.stringify(kinds));
    assert.ok(kinds.includes("privacy_export_made"), JSON.stringify(kinds));
    assert.equal(json(act(governor, id, "complete")).status, "completed");
    assert.equal(
      q(
        `select string_agg(action,',' order by occurred_at,action) from private.privacy_request_events where request_id='${id}';`
      ),
      "submitted,identity_verified,started,exported,exported,completed"
    );
    // The requester's email job carries the new kind as the website reads it.
    const claimed = json(service("select api.claim_frontend_privacy_notice();"));
    assert.ok(["submitted", "approved", "exported", "completed"].includes(claimed.kind));
  });
  await check("privacy: a request started before the update needs a second approval", () => {
    const requester = named("ayanda", "Ayanda", "Zulu");
    const id = record(requester);
    q(act(admin, id, "verify_identity"));
    // As the update finds it: started (by governor) and not approved.
    q(`set session_replication_role=replica;
      update private.privacy_requests set status='in_progress',processed_by='${governor.id}',revision=revision+1 where id='${id}';
      insert into private.privacy_request_events(request_id,actor_id,action,represented_revision)
        values('${id}','${governor.id}','started',2);`);
    const rows = preflight();
    assert.match(rows[0][1], /without a second approval: 1;/);
    fails(exportAs(admin, id), "PT409", /approve this request first/);
    fails(act(admin2, id, "complete"), "PT409", /approve this request first/);
    fails(act(governor, id, "approve"), "42501", SECOND_PERSON);
    fails(act(admin, id, "approve"), "42501", SECOND_PERSON);
    assert.equal(json(act(admin2, id, "approve")).status, "in_progress");
    assert.equal(privacy(id).status, "in_progress");
    fails(act(admin2, id, "approve"), "PT409", /already approved/);
    assert.equal(
      count(`private.privacy_request_events where request_id='${id}' and action='approved'`),
      1
    );
    assert.equal(notices(requester, "privacy_request_approved"), 1);
    json(exportAs(governor, id));
    assert.equal(jobs(id), "submitted,approved,exported");
    // The rollback keeps a recorded second approval.
    assert.match(fails(ROLLBACK, "55000"), /second approval recorded/);
  });

  // ---------------------------------------------------- 3. support inbox
  await check("support inbox: a recent second factor and 12 months", () => {
    const ticket = (status, age) =>
      q(`insert into private.support_tickets(name,email,category,message,status,created_at)
        values('Fixture Person','person@example.invalid','general_support','A synthetic support message.','${status}',now()-interval '${age}')
        returning id;`);
    const recent = ticket("resolved", "2 months");
    const oldOpen = ticket("in_progress", "14 months");
    const oldNew = ticket("new", "15 months");
    const oldResolved = ticket("resolved", "13 months");
    for (const who of [moderator, governor, admin])
      fails(staff(who, "select api.get_frontend_support_inbox(1,null);", stale()), "42501", RECENT);
    const page = json(staff(moderator, "select api.get_frontend_support_inbox(1,null);"));
    const ids = page.items.map((r) => r.id);
    for (const id of [recent, oldOpen, oldNew]) assert.ok(ids.includes(id), id);
    assert.equal(ids.includes(oldResolved), false);
    assert.equal(page.total, 3);
    const one = json(staff(governor, `select api.get_frontend_support_inbox(1,'${oldResolved}');`));
    assert.deepEqual([one.total, one.items.length], [0, 0]);
    assert.match(preflight()[0][1], /resolved support tickets older than 12 months: 1$/);
    // The metrics (counts of new tickets) need no recent second factor.
    assert.equal(
      json(staff(moderator, "select api.get_frontend_support_metrics();", stale())).new,
      1
    );
  });

  // ----------------------------------------------------------- 4. invoices
  await check("staff invoice and transfer reads need a recent second factor", () => {
    const reads = [
      "select api.get_staff_invoices();",
      "select api.get_staff_invoice('VM-2026-999999');",
      "select api.get_staff_invoice_transfers();",
      "select api.get_staff_invoice_payments(array[]::uuid[]);",
    ];
    for (const sql of reads) {
      fails(staff(admin, sql, stale()), "42501", RECENT);
      fails(staff(moderator, sql), "42501", /capability not granted/);
      fails(member(thandeka, sql), "42501");
    }
    assert.equal(json(staff(admin, reads[0])).items.length, 0);
    fails(staff(admin, reads[1]), "PT404");
    assert.equal(json(staff(admin, reads[2])).waiting, 0);
    json(staff(admin, reads[3]));
  });

  // ------------------------------------------- 5. organisation dashboard
  await check("organisation dashboard: no applicant contacts, co-admins by short name", () => {
    const owner = named("busi", "Busisiwe", "Mokoena");
    const coAdmin = named("sipho", "Sipho", "Ndlovu");
    const outsider = named("naledi", "Naledi", "Sithole");
    const slug = `minimum-org-${Date.now()}`;
    const org = q(`set session_replication_role=replica;
      insert into private.organisations(slug,name,programme_status,is_public)
        values('${slug}','Minimum Organisation','founding_trial',true) returning id;`);
    q(`set session_replication_role=replica;
      insert into private.organisation_admins(organisation_id,account_id,role) values
        ('${org}','${owner.id}','owner'),('${org}','${coAdmin.id}','admin');`);
    const applicant = (person, status, phone, email) => {
      const post = q(`select vmtest.live_event('${person.id}','${phone}','${email}');`);
      return q(`set session_replication_role=replica;
        insert into private.organisation_applications(organisation_id,post_id,applicant_id,share_representative_name,consented_at,status,
            decision_at,decision_by)
          values('${org}','${post}','${person.id}',false,now(),'${status}',
            ${["approved", "declined"].includes(status) ? `now(),'${owner.id}'` : "null,null"}) returning id;`);
    };
    const pending = applicant(thandeka, "submitted", "+27820000201", "pending@example.invalid");
    const moreInfo = applicant(
      named("zanele", "Zanele", "Mthembu"),
      "more_info_required",
      "+27820000202",
      "more-info@example.invalid"
    );
    const declined = applicant(
      named("thabo", "Thabo", "Molefe"),
      "declined",
      "+27820000203",
      "declined@example.invalid"
    );
    const accepted = applicant(
      named("kagiso", "Kagiso", "Botha"),
      "approved",
      "+27820000204",
      "accepted@example.invalid"
    );
    const withdrawn = applicant(
      named("lindiwe", "Lindiwe", "Nkosi"),
      "withdrawn",
      "+27820000205",
      "withdrawn@example.invalid"
    );
    const dashboard = json(
      member(owner, `select api.get_frontend_organisation_dashboard('${slug}');`)
    );
    assert.equal("public_contacts" in dashboard, false);
    const text = JSON.stringify(dashboard);
    for (const value of ["+278200002", "@example.invalid", "https://example.invalid"])
      assert.equal(text.includes(value), false, value);
    const names = Object.fromEntries(dashboard.admins.map((a) => [a.user_id, a.display_name]));
    assert.deepEqual(names, {
      [owner.id]: "Busisiwe Mokoena",
      [coAdmin.id]: "Sipho N.",
    });
    const coView = json(
      member(coAdmin, `select api.get_frontend_organisation_dashboard('${slug}');`)
    );
    assert.deepEqual(Object.fromEntries(coView.admins.map((a) => [a.user_id, a.display_name])), {
      [owner.id]: "Busisiwe M.",
      [coAdmin.id]: "Sipho Ndlovu",
    });

    const reveal = (who, id) =>
      member(who, `select api.reveal_organisation_applicant_contact('${id}');`);
    const shown = json(reveal(owner, pending));
    assert.equal(shown.application_id, pending);
    assert.equal(shown.phone, "+27820000201");
    assert.equal(shown.email, "pending@example.invalid");
    assert.match(shown.website, /^https:\/\/example\.invalid\//);
    assert.equal(json(reveal(coAdmin, moreInfo)).phone, "+27820000202");
    for (const id of [declined, accepted, withdrawn])
      fails(reveal(owner, id), "PT409", /only while the application is pending/);
    fails(reveal(outsider, pending), "42501");
    fails(reveal(owner, crypto.randomUUID()), "PT404");
    // Staff with organisation:manage act for any organisation.
    assert.equal(
      json(staff(admin, `select api.reveal_organisation_applicant_contact('${pending}');`)).phone,
      "+27820000201"
    );
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the short names and the recent second factor", () => {
      const row = queueOf(moderator).groups.find((g) => g.case_id === kyc);
      assert.equal(row.display_name, "Thandeka D.");
      fails(staff(admin, "select api.get_staff_invoice_transfers();", stale()), "42501", RECENT);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Staff data minimisation checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
