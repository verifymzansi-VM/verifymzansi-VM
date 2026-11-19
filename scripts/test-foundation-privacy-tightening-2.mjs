#!/usr/bin/env node
// Behaviour checks for 20261119065758_privacy_tightening_2.sql:
//
// 1. analytics and third-party sharing cannot be turned on (22023
//    choice_unavailable); turning them off, or saving them unchanged, works,
//    also for a member who turned one on before the update;
// 2. the staff ID check counters count exactly the cases the ID check queue
//    lists (an open case with nothing to review is not counted);
// 3. search refuses a page offset above 4,800 for visitors;
// 4. a partner rate is at most 20%, in the command and in the table;
// 5. the enforcement, partner and staff organisation reads name a verified
//    member by their short name;
// 6. the staff organisation detail carries no applicant contacts; staff ask
//    for one pending application's contact, which is logged;
// 7. a past decider (or assigned visitor) of a business check opens its
//    private details without a claim only until 90 days after the decision;
// 8. closing an account counts only a recent password or Google sign-in.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. The script runs the update's read-only preflight, checks its refusals,
// applies it, proves apply -> rollback -> apply returns the same fingerprints,
// then checks every rule through the production API commands as visitors,
// members, staff (synthetic sessions with a verified authenticator app) and
// the database owner for rows other commands own. Any later updates are
// applied at the end.
//
//   node --import tsx scripts/test-foundation-privacy-tightening-2.mjs
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

const UPDATE = "20261119065758_privacy_tightening_2.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const SEARCH = "internal.search_posts(jsonb)";

const {
  started,
  database,
  check,
  current,
  passed: checks,
  q,
  json,
  fails,
  as,
  claims,
  member,
  staff,
  fingerprint,
  preflightRows: preflight,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const count = (sql) => Number(q(`select count(*) from ${sql};`));
  const now = () => Math.floor(Date.now() / 1000);

  // ------------------------------------------------------- synthetic world
  const { user, staffUser, verify } = installStaffPaymentWorld(q, json);
  const admin = staffUser("admin", "admin");
  const governor = staffUser("governor", "governor");
  const moderator = staffUser("moderator", "moderator");
  /** A member with an accepted ID review whose display name is `first last`. */
  const named = (label, first, last) => {
    const person = user(label);
    verify(person, admin, label);
    q(`set session_replication_role=replica;
      update private.profiles set display_name='${first} ${last}',legal_first_name='${first}',legal_last_name='${last}'
        where account_id='${person.id}';`);
    return person;
  };
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
    -- A decided business check: rejected by p_staff p_days ago (p_assigned
    -- assigned to the visit).
    create function vmtest.decide_check(p_case uuid,p_staff uuid,p_assigned uuid,p_days integer) returns void language plpgsql as $$
    begin
      perform set_config('session_replication_role','replica',true);
      update private.frontend_business_checks set status='rejected',reviewed_by=p_staff,assigned_to=p_assigned,
        decided_at=now()-make_interval(days=>p_days),updated_at=now() where id=p_case;
      -- Claimed once before the decision, as every decided case was.
      update private.evidence_cases set status='decided',claim_generation=greatest(claim_generation,1) where id=p_case;
      perform set_config('session_replication_role','origin',true);
    end$$;
    -- An open ID check case; with a submission at the case's version unless
    -- p_empty (an empty case left by an earlier page view).
    create function vmtest.kyc_case(p_owner uuid,p_empty boolean) returns uuid language plpgsql as $$
    declare cid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
      perform set_config('session_replication_role','replica',true);
      insert into private.evidence_cases(id,subject_id,kind) values(cid,p_owner,'kyc');
      if not p_empty then
        insert into private.verification_identity_submissions(id,case_id,owner_id,case_version,id_artifact_id,selfie_artifact_id,
            identity_hmac,identity_key_id,number_ciphertext,number_iv,number_tag,encryption_key_id,receipt_id,recipe,risk_score)
          values(sid,cid,p_owner,1,gen_random_uuid(),gen_random_uuid(),rpad('fixture',42,'x')||'A','identity-match-v1',
            repeat('a',26),repeat('b',24),repeat('c',32),'identity-number-v1',gen_random_uuid(),'manual-id-selfie-v1',10);
        insert into private.verification_current_submissions(case_id,submission_id) values(cid,sid);
      end if;
      perform set_config('session_replication_role','origin',true);
      return cid;
    end$$;
    -- A member's choice saved before the update hid it (as the earlier website allowed).
    create function vmtest.choice_on(p_account uuid,p_purpose text) returns void language sql as $$
      insert into private.communication_choice_events(account_id,purpose,granted,wording_version)
        values(p_account,p_purpose,true,'communication-2026-11');
    $$;`);

  const early = named("early", "Early", "Adopter");
  q(`select vmtest.choice_on('${early.id}','analytics');`);
  const thandeka = named("thandeka", "Thandeka", "Dlamini");
  const pendingFor = (who) => q(`select vmtest.kyc_case('${who.id}',false);`);
  const emptyFor = (who) => q(`select vmtest.kyc_case('${who.id}',true);`);
  const waiting = pendingFor(thandeka);
  const empty = emptyFor(named("empty", "Empty", "Case"));
  const dashboard = (who) => json(staff(who, "select api.get_staff_dashboard();"));
  const queueTotal = (who) =>
    json(staff(who, "select api.get_frontend_staff_verification_queue(100,'{}');")).groups.length;

  // ------------------------------------------------------------ before
  await check("before the update: the counter includes the empty ID case", () => {
    const view = dashboard(moderator);
    assert.equal(view.counts.kyc, 2);
    assert.equal(view.restored_queues.kyc.pending, 2);
    assert.equal(queueTotal(moderator), 1);
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
      "privacy tightening 2: update not applied; analytics on: 1; third-party sharing on: 0; partners above 20%: 0; open ID checks with nothing to review: 1"
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift, a premature rollback and a partner rate above 20% are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    const live = q(`select pg_get_functiondef('${SEARCH}'::regprocedure);`);
    q(
      `do $$begin execute replace(pg_get_functiondef('${SEARCH}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[0][1], /unexpected state/);
    assert.match(rows[1][1], /search_posts.* is neither the reviewed body nor the update's/);
    assert.match(fails(step.sql, "55000"), /privacy tightening 2 precondition/);
    q(`${live};`);
    // A partner above 20% blocks the update until staff lower the rate.
    const partner = user("high-rate");
    q(`insert into private.partners(account_id,code,commission_bps,created_by)
      values('${partner.id}','HIGHRATE',2500,'${admin.id}');`);
    const high = preflight();
    assert.equal(high.length, 2, JSON.stringify(high));
    assert.match(high[0][1], /partners above 20%: 1;/);
    assert.match(high[1][1], /partner HIGHRATE has a rate above 20%/);
    assert.match(fails(step.sql, "55000"), /a partner rate is above 20%/);
    q(`delete from private.partners where code='HIGHRATE';`);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "privacy tightening 2",
    fingerprint,
    preflightRows: preflight,
    appliedSummary:
      /^privacy tightening 2: already applied; analytics on: 1; third-party sharing on: 0; partners above 20%: 0; open ID checks with nothing to review: 1$/,
  });

  // ------------------------------------------------ 1. communication choices
  const save = (who, args) =>
    member(who, `select api.save_my_communication_choices('communication-2026-11',${args});`);
  const choices = (who) => json(member(who, "select api.get_my_communication_choices();"));
  await check("analytics and third-party sharing cannot be turned on", () => {
    const fresh = user("fresh");
    for (const args of [
      "p_analytics=>true",
      "p_third_party_sharing=>true",
      "p_marketing_email=>true,p_analytics=>true",
    ])
      fails(save(fresh, args), "22023", /choice_unavailable/);
    assert.deepEqual(choices(fresh), {
      marketing_email: false,
      marketing_sms: false,
      analytics: false,
      third_party_sharing: false,
    });
    assert.equal(count(`private.communication_choice_events where account_id='${fresh.id}'`), 0);
    // The other choices, and turning these off, still work.
    assert.equal(json(save(fresh, "p_marketing_email=>true")).marketing_email, true);
    assert.equal(
      json(save(fresh, "p_analytics=>false,p_third_party_sharing=>false")).analytics,
      false
    );
  });
  await check("a member who turned analytics on earlier keeps it and can turn it off", () => {
    assert.equal(choices(early).analytics, true);
    // Saving it unchanged is not turning it on.
    assert.equal(json(save(early, "p_analytics=>true,p_marketing_sms=>true")).analytics, true);
    assert.equal(json(save(early, "p_analytics=>false")).analytics, false);
    fails(save(early, "p_analytics=>true"), "22023", /choice_unavailable/);
  });

  // ------------------------------------------------------ 2. ID counters
  await check("the ID check counters count exactly what the queue lists", () => {
    for (const who of [moderator, governor, admin]) {
      const view = dashboard(who);
      assert.equal(view.counts.kyc, 1);
      assert.equal(view.restored_queues.kyc.pending, 1);
      assert.equal(queueTotal(who), 1);
    }
    // A submitted case is counted; the staff member's own case is not (they
    // cannot review it, and the queue does not list it).
    const second = pendingFor(named("second", "Second", "Member"));
    const own = pendingFor(moderator);
    assert.equal(dashboard(moderator).counts.kyc, 2);
    assert.equal(queueTotal(moderator), 2);
    assert.equal(dashboard(governor).counts.kyc, 3);
    assert.equal(queueTotal(governor), 3);
    // A case whose account is no longer active leaves both.
    q(`set session_replication_role=replica;
      update private.evidence_cases set status='closed' where id in('${second}','${own}');`);
    assert.equal(dashboard(governor).restored_queues.kyc.pending, queueTotal(governor));
    assert.equal(
      count(`private.evidence_cases where id in('${waiting}','${empty}') and status='open'`),
      2
    );
  });

  // ------------------------------------------------------------ 3. search
  await check("visitors can page to offset 4,800, not deeper", () => {
    const search = (offset) =>
      `set role anon;\nselect api.search_posts('{"area":"market","limit":48,"offset":${offset}}'::jsonb);`;
    assert.equal(json(search(4800)).items.length, 0);
    assert.match(fails(search(4848), "22023"), /invalid page offset/);
    assert.match(fails(search(500000), "22023"), /invalid page offset/);
  });

  // ----------------------------------------------------------- 4. partners
  const partnerOf = (who, action, rate, code = null) =>
    staff(
      admin,
      `select api.staff_save_partner('${who.id}','${action}','Synthetic partner change',${code ? `'${code}'` : "null"},${rate});`
    );
  const partnerPerson = named("sipho", "Sipho", "Ndlovu");
  await check("a partner rate is at most 20%", () => {
    fails(partnerOf(partnerPerson, "create", 2001, "SIPHO01"), "22023", /partner_invalid/);
    assert.equal(json(partnerOf(partnerPerson, "create", 2000, "SIPHO01")).commission_bps, 2000);
    fails(partnerOf(partnerPerson, "set_rate", 2500), "22023", /partner_invalid/);
    assert.equal(json(partnerOf(partnerPerson, "set_rate", 1500)).commission_bps, 1500);
    fails(
      `update private.partners set commission_bps=2001 where code='SIPHO01';`,
      "23514",
      /partners_commission_bps_check/
    );
    assert.equal(q(`select commission_bps from private.partners where code='SIPHO01';`), "1500");
  });

  // -------------------------------------------------------- 5. short names
  const noFullName = (value, surname, label) =>
    assert.equal(JSON.stringify(value).includes(surname), false, label);
  await check("enforcement, partner and organisation reads show short names", () => {
    const banned = named("lerato", "Lerato", "Mokoena");
    q(`set session_replication_role=replica;
      with c as (insert into private.evidence_cases(subject_id,kind,status) values('${banned.id}','restriction','decided') returning id)
      insert into private.decisions(case_id,action,payload,case_version,reviewed_snapshot,proposed_by,approved_by,approved_at,status)
        select id,'restrict_account','{}',1,'[]','${governor.id}','${admin.id}',now(),'approved' from c;`);
    const enforcement = json(staff(admin, "select api.get_frontend_enforcement();"));
    const row = enforcement.items.find((r) => r.account_id === banned.id);
    assert.equal(row.display_name, "Lerato M.");
    noFullName(enforcement, "Mokoena", "enforcement");

    const partners = json(staff(admin, "select api.get_frontend_partner_admin();"));
    assert.equal(
      partners.partners.find((p) => p.account_id === partnerPerson.id).display_name,
      "Sipho N."
    );
    noFullName(partners, "Ndlovu", "partner admin");

    const owner = named("busi", "Busisiwe", "Khumalo");
    const org = q(`set session_replication_role=replica;
      insert into private.organisations(slug,name,programme_status,is_public)
        values('short-names-${Date.now()}','Short Names Organisation','founding_trial',true) returning id;`);
    q(`set session_replication_role=replica;
      insert into private.organisation_admins(organisation_id,account_id,role) values('${org}','${owner.id}','owner');`);
    for (const command of ["staff_get_organisation", "get_frontend_staff_organisation_detail"]) {
      const detail = json(staff(admin, `select api.${command}('${org}');`));
      assert.deepEqual(
        detail.admins.map((a) => a.display_name),
        ["Busisiwe K."],
        command
      );
      noFullName(detail, "Khumalo", command);
    }
  });

  // --------------------------------------- 6. staff organisation contacts
  await check("the staff organisation detail carries no applicant contacts", () => {
    const org = q(`set session_replication_role=replica;
      insert into private.organisations(slug,name,programme_status,is_public)
        values('contacts-${Date.now()}','Contacts Organisation','founding_trial',true) returning id;`);
    const applicant = (label, status, phone) => {
      const person = named(label, label[0].toUpperCase() + label.slice(1), "Applicant");
      const post = q(
        `select vmtest.live_event('${person.id}','${phone}','${label}@example.invalid');`
      );
      return q(`set session_replication_role=replica;
        insert into private.organisation_applications(organisation_id,post_id,applicant_id,share_representative_name,consented_at,status,
            decision_at,decision_by)
          values('${org}','${post}','${person.id}',false,now(),'${status}',
            ${status === "declined" ? `now(),'${admin.id}'` : "null,null"}) returning id;`);
    };
    const pending = applicant("ayanda", "submitted", "+27820000301");
    const declined = applicant("kagiso", "declined", "+27820000302");
    const detail = json(
      staff(admin, `select api.get_frontend_staff_organisation_detail('${org}');`)
    );
    assert.equal("public_contacts" in detail, false);
    for (const value of ["+278200003", "@example.invalid", "https://example.invalid"])
      assert.equal(JSON.stringify(detail).includes(value), false, value);
    const reveal = (id) =>
      staff(admin, `select api.reveal_organisation_applicant_contact('${id}');`);
    assert.equal(json(reveal(pending)).phone, "+27820000301");
    fails(reveal(declined), "PT409", /only while the application is pending/);
    assert.equal(
      count(`private.organisation_events where organisation_id='${org}'
        and action='applicant_contact_revealed' and actor_id='${admin.id}' and subject_id='${pending}'`),
      1
    );
  });

  // ------------------------------------------- 7. past deciders, 90 days
  await check("a past decider reads a business check without a claim for 90 days", () => {
    const owner = named("zanele", "Zanele", "Mthembu");
    const post = q(
      `select vmtest.live_event('${owner.id}','+27820000401','zanele@example.invalid');`
    );
    const logged = (id) => count(`private.evidence_access_log where case_id='${id}'`);
    for (const kind of ["cipc", "seen"]) {
      const command = kind === "cipc" ? "get_frontend_cipc_case" : "get_frontend_seen_case";
      const id = q(`select vmtest.business_case('${owner.id}','${post}','${kind}');`);
      const read = (who) => json(staff(who, `select api.${command}('${id}');`));
      q(`select vmtest.decide_check('${id}','${moderator.id}',null,10);`);
      assert.equal(read(moderator).owner.legalName, "Zanele Mthembu", `${kind} at 10 days`);
      assert.equal(logged(id), 1, kind);
      q(`select vmtest.decide_check('${id}','${moderator.id}',null,91);`);
      const late = read(moderator);
      assert.equal(late.owner.legalName, null, `${kind} at 91 days`);
      assert.equal(late.owner.displayName, "Zanele M.", kind);
      noFullName(late, "Mthembu", kind);
      assert.equal(logged(id), 1, `${kind}: nothing more logged`);
      // Another staff member never could without a claim.
      q(`select vmtest.decide_check('${id}','${moderator.id}',null,10);`);
      assert.equal(read(governor).owner.legalName, null, kind);
    }
    // The visitor assigned to a 'seen in person' check, and its photos.
    const seen = q(`select vmtest.business_case('${owner.id}','${post}','seen');`);
    const photo = q(`set session_replication_role=replica;
      insert into private.frontend_business_seen_photos(artifact_id,check_id,content_digest,mime)
        values(gen_random_uuid(),'${seen}',repeat('d',64),'image/jpeg') returning artifact_id;`);
    const file = (who) => staff(who, `select api.authorize_frontend_seen_file('${photo}',false);`);
    q(`select vmtest.decide_check('${seen}','${admin.id}','${governor.id}',10);`);
    assert.equal(
      json(staff(governor, `select api.get_frontend_seen_case('${seen}');`)).owner.legalName,
      "Zanele Mthembu"
    );
    // Within the window the permission check passes (the photo has no
    // stored file in this fixture, so it is then "not available").
    fails(file(governor), "PT404", /photo not available/);
    fails(file(admin), "PT404", /photo not available/);
    q(`select vmtest.decide_check('${seen}','${admin.id}','${governor.id}',91);`);
    assert.equal(
      json(staff(governor, `select api.get_frontend_seen_case('${seen}');`)).owner.legalName,
      null
    );
    fails(file(governor), "42501", /an authorized verifier must view this photo/);
    fails(file(admin), "42501", /an authorized verifier must view this photo/);
    // Undecided: the assigned visitor reads as before.
    q(`set session_replication_role=replica;
      update private.frontend_business_checks set status='pending',decided_at=null,reviewed_by=null where id='${seen}';
      update private.evidence_cases set status='open' where id='${seen}';`);
    assert.equal(
      json(staff(governor, `select api.get_frontend_seen_case('${seen}');`)).owner.legalName,
      "Zanele Mthembu"
    );
    fails(file(governor), "PT404", /photo not available/);
  });

  // ------------------------------------------------- 8. closing an account
  await check("closing an account counts only a recent password or Google sign-in", () => {
    const closeWith = (who, amr) => as({ ...claims(who), amr }, "select api.close_my_account();");
    const refused = (amr) => {
      const who = user("close-refused");
      assert.match(
        fails(closeWith(who, amr), "42501"),
        /recent_sign_in_required/,
        JSON.stringify(amr)
      );
    };
    for (const method of [
      "recovery",
      "otp",
      "magiclink",
      "invite",
      "totp",
      "email/signup",
      "sso/saml",
    ])
      refused([{ method, timestamp: now() - 60 }]);
    refused([{ method: "password", timestamp: now() - 20 * 60 }]);
    refused([{ method: "password", timestamp: now() + 3600 }]);
    refused([{ method: "password", timestamp: String(now() - 60) }]);
    refused([
      { method: "password", timestamp: now() - 20 * 60 },
      { method: "recovery", timestamp: now() - 60 },
    ]);
    for (const method of ["password", "oauth"]) {
      const who = user(`close-${method}`);
      const closed = json(
        closeWith(who, [
          { method: "totp", timestamp: now() - 30 },
          { method, timestamp: now() - 60 },
        ])
      );
      assert.ok(closed, method);
      assert.equal(count(`private.account_erasures where user_id='${who.id}'`), 1, method);
    }
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the search depth and the partner limit", () => {
      fails(
        `set role anon;\nselect api.search_posts('{"area":"market","limit":48,"offset":4848}'::jsonb);`,
        "22023"
      );
      fails(partnerOf(partnerPerson, "set_rate", 2001), "22023", /partner_invalid/);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Privacy tightening 2 checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
