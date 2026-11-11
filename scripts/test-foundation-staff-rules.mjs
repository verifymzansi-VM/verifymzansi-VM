#!/usr/bin/env node
// Behaviour checks for the staff rules of the production (foundation) schema:
// staff role review (20261105093342_restored_staff_role_review.sql), privacy
// requests (20261105085900_restored_privacy_requests.sql), report actions,
// content holds and appeals (20261104231625_restored_report_actions.sql,
// 20261105043010_native_report_content_holds.sql,
// 20261105053509_restored_member_appeals.sql), mail outbox lease fencing and
// the activation limit per period.
//
// scripts/test-restored-post-commands.mjs checked most of these first, but on
// the older prototype fixture, which carries only some of the updates. This
// script replays ALL of database/foundation (prelude, candidate.sql, every
// update: what production runs) into the throwaway, network-less Postgres 17
// container of the SQL lint gate, then calls the production API commands:
// members and staff as `authenticated` with synthetic JWT claims and live
// session rows (staff with a verified authenticator app and an AAL2 session),
// jobs and server routes as `service_role`.
//
//   node --import tsx scripts/test-foundation-staff-rules.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
// Fixtures are written directly as the database owner: members, staff roles,
// live event posts and plan entitlements. Time is simulated by moving clock
// columns back. auth.users gains phone_confirmed_at, a Supabase Auth column
// the replay prelude leaves out. The only stand-in is internal.current_verified_identity, which
// answers for the members listed in vmtest.verified and runs the production
// body for everyone else (identity review has its own suites); it lets a
// released content hold restore the post as it does for a verified owner.
import assert from "node:assert/strict";
import { replaySteps } from "./lib/foundation-replay.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

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
  const { steps, updates } = replaySteps();
  applySteps(database, steps);
  console.log(`Replayed candidate.sql and ${updates.length} updates.`);

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
  // A staff session whose authenticator app was verified at `totpAt` (now by
  // default).
  const staff = (user, sql, totpAt = Math.floor(Date.now() / 1000)) =>
    as({ ...claims(user), aal: "aal2", amr: [{ method: "totp", timestamp: totpAt }] }, sql);
  const service = (sql) => `set role service_role;\n${sql}`;
  const scalar = (sql) => q(sql);
  const count = (sql) => Number(scalar(`select count(*) from ${sql};`));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ------------------------------------------------------- synthetic world
  const original = scalar(
    "select pg_get_functiondef('internal.current_verified_identity(uuid)'::regprocedure);"
  );
  assert.match(original, /accepted_identity_facts/);
  // Supabase Auth has this column; the replay prelude's auth.users stand-in
  // does not, and the privacy export reads it.
  q(`alter table auth.users add column phone_confirmed_at timestamptz;
    create schema vmtest;
    create table vmtest.verified(owner_id uuid primary key);
    create function vmtest.member(p_label text) returns jsonb language plpgsql as $$
    declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(uid,p_label||'-'||uid||'@example.invalid',now(),jsonb_build_object('display_name','Fixture '||p_label));
      insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
      return jsonb_build_object('id',uid,'session',sid,'email',p_label||'-'||uid||'@example.invalid');
    end$$;
    -- A verified authenticator app and an AAL2 session, with no staff role.
    create function vmtest.second_factor(p_user uuid,p_session uuid) returns void language sql as $$
      update auth.sessions set aal='aal2' where id=p_session;
      insert into auth.mfa_factors(user_id,factor_type,status) values(p_user,'totp','verified');
    $$;
    create function vmtest.staff(p_label text,p_role text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      perform vmtest.second_factor((m->>'id')::uuid,(m->>'session')::uuid);
      insert into private.staff_roles(user_id,role) values((m->>'id')::uuid,p_role);
      return m;
    end$$;
    create function vmtest.media(p_owner uuid) returns uuid language plpgsql as $$
    declare oid uuid:=gen_random_uuid(); begin
      insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,width,height,state)
        values(oid,p_owner,'image','media/'||oid,1024,1024,encode(sha256(convert_to(oid::text,'UTF8')),'hex'),'image/jpeg',800,600,'ready');
      return oid;
    end$$;
    -- A post with one ready cover image and the form contact channel; a live
    -- event is public until it ends (events need no plan).
    create function vmtest.post(p_owner uuid,p_kind text,p_live boolean) returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); area text; cat text; begin
      area:=case p_kind when 'listing' then 'market' else 'tourism_events' end;
      cat:=case p_kind when 'listing' then 'other_items' else 'events' end;
      insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
        values(pid,p_owner,p_kind,area,cat,(select a.key from private.category_activities a join private.categories c on c.key=a.category_key
          where a.category_key=cat and c.activity_required order by a.key limit 1),
          'Fixture '||p_kind||' '||left(pid::text,8),'A synthetic description long enough for every rule.','gp','gp_johannesburg');
      if p_kind='listing' then insert into private.listing_details(post_id,price_mode,price_cents) values(pid,'amount',12000);
      else insert into private.event_details(post_id,starts_at,ends_at,timezone)
        values(pid,date_trunc('milliseconds',now()+interval '20 days'),date_trunc('milliseconds',now()+interval '21 days'),'Africa/Johannesburg'); end if;
      insert into private.post_contacts(post_id,post_kind,channels) values(pid,p_kind,array['form']);
      insert into private.post_media(post_id,object_id,purpose,position) values(pid,vmtest.media(p_owner),'cover',0);
      if p_live then
        update private.posts set status='live',published_at=now()-interval '2 days',
          visible_until=(select e.ends_at from private.event_details e where e.post_id=pid) where id=pid;
      end if;
      return pid;
    end$$;
    create or replace function internal.current_verified_identity(p_owner uuid) returns text
      language sql set search_path to 'pg_catalog' as $fn$
      select case when exists(select 1 from vmtest.verified v where v.owner_id=p_owner)
          and exists(select 1 from private.current_account_access a where a.id=p_owner) then 'fixture-identity'
        else (select f.identity_hmac from private.accepted_identity_facts f
          join private.verification_identity_submissions s on s.id=f.submission_id
          join private.evidence_cases c on c.id=s.case_id and c.subject_id=p_owner
          where f.owner_id=p_owner and f.revoked_at is null and c.status='decided' and c.version=s.case_version+1
            and internal.verification_evidence_reviewed(s.id)
            and exists(select 1 from private.current_account_access a where a.id=p_owner)
            and exists(select 1 from private.verification_phone_proofs p where p.owner_id=p_owner and p.revoked_at is null)
            and exists(select 1 from private.verification_localities l where l.owner_id=p_owner)) end $fn$;`);
  const user = (label) => json(`select vmtest.member('${label}');`);
  const staffUser = (label, role) => json(`select vmtest.staff('${label}','${role}');`);
  const livePost = (owner) => scalar(`select vmtest.post('${owner.id}','event',true);`);
  const role = (who) =>
    scalar(
      `select coalesce((select role from private.staff_roles where user_id='${who.id}' and revoked_at is null),'member');`
    );
  const change = (id) =>
    json(`select to_jsonb(c) from private.frontend_staff_role_changes c where c.id='${id}';`);

  const admin = staffUser("admin", "admin"),
    admin2 = staffUser("admin2", "admin"),
    governor = staffUser("governor", "governor"),
    moderator = staffUser("moderator", "moderator");

  // ----------------------------------------------------------- staff roles
  await check("staff roles: nobody can propose a change to their own role", () => {
    for (const [who, to] of [
      [admin, "member"],
      [governor, "member"],
    ]) {
      fails(
        staff(
          who,
          `select api.propose_frontend_staff_role('${who.email}','${to}','Synthetic self change');`
        ),
        "42501",
        /staff cannot change their own role/
      );
      assert.equal(role(who), who === admin ? "admin" : "governor");
    }
    assert.equal(count("private.frontend_staff_role_changes"), 0);
  });

  await check("staff roles: a non-admin cannot propose an appointment", () => {
    const thandi = user("thandi");
    // A governor may only propose removing a moderator.
    fails(
      staff(
        governor,
        `select api.propose_frontend_staff_role('${thandi.email}','moderator','Synthetic appointment by a governor');`
      ),
      "42501",
      /staff role change not authorized/
    );
    // A moderator has no role review capability at all.
    fails(
      staff(
        moderator,
        `select api.propose_frontend_staff_role('${thandi.email}','moderator','Synthetic appointment by a moderator');`
      ),
      "42501",
      /capability not granted/
    );
    // A member has no staff session.
    fails(
      member(
        thandi,
        `select api.propose_frontend_staff_role('${thandi.email}','moderator','Synthetic self appointment');`
      ),
      "42501"
    );
    assert.equal(role(thandi), "member");
    assert.equal(count("private.frontend_staff_role_changes"), 0);
  });

  await check(
    "staff roles: an appointment waits for an independent second staff member",
    async () => {
      const xola = user("xola");
      q(`select vmtest.second_factor('${xola.id}','${xola.session}');`);
      const proposed = json(
        staff(
          admin,
          `select api.propose_frontend_staff_role('${xola.email}','moderator','Synthetic moderator appointment');`
        )
      );
      assert.equal(proposed.status, "proposed");
      assert.equal(role(xola), "member", "a proposal alone grants nothing");
      // The proposer cannot approve it.
      fails(
        staff(admin, `select api.review_frontend_staff_role('${proposed.id}','approve',1);`),
        "42501",
        /independent staff role reviewer required/
      );
      assert.equal(change(proposed.id).status, "proposed");
      assert.equal(role(xola), "member");
      // Only one change may be pending for an account.
      fails(
        staff(
          admin2,
          `select api.propose_frontend_staff_role('${xola.email}','governor','Synthetic competing proposal');`
        ),
        "PT409",
        /already pending/
      );
      const proofBefore = Math.floor(Date.now() / 1000) - 5;
      const approved = json(
        staff(
          governor,
          `select api.review_frontend_staff_role('${proposed.id}','approve',1,'Synthetic independent review');`
        )
      );
      assert.equal(approved.status, "applied");
      const decided = change(proposed.id);
      assert.equal(decided.status, "applied");
      assert.equal(decided.proposer_id, admin.id);
      assert.equal(decided.reviewer_id, governor.id);
      assert.equal(role(xola), "moderator");
      assert.equal(
        scalar(
          `select granted_by from private.staff_roles where user_id='${xola.id}' and revoked_at is null;`
        ),
        governor.id
      );
      // An approved decision cannot be decided again.
      fails(
        staff(admin2, `select api.review_frontend_staff_role('${proposed.id}','approve',1);`),
        "PT409"
      );
      // A second-factor proof from before the assignment does not open staff
      // commands; a new one does.
      fails(
        staff(xola, "select api.get_frontend_staff_claims();", proofBefore),
        "42501",
        /second-factor verification required after role assignment/
      );
      await sleep(1100);
      assert.equal(json(staff(xola, "select api.get_frontend_staff_claims();")).own_count, 0);
    }
  );

  await check("staff roles: a governor cannot approve beyond a moderator appointment", () => {
    const lwazi = user("lwazi");
    const proposed = json(
      staff(
        admin,
        `select api.propose_frontend_staff_role('${lwazi.email}','governor','Synthetic governor appointment');`
      )
    );
    fails(
      staff(governor, `select api.review_frontend_staff_role('${proposed.id}','approve',1);`),
      "42501",
      /staff role review not authorized/
    );
    assert.equal(change(proposed.id).status, "proposed");
    assert.equal(role(lwazi), "member");
    // A second admin can; the change applies.
    assert.equal(
      json(staff(admin2, `select api.review_frontend_staff_role('${proposed.id}','approve',1);`))
        .status,
      "applied"
    );
    assert.equal(role(lwazi), "governor");
  });

  await check("staff roles: nobody can approve a change to their own role", () => {
    // An owner-approved administrator invitation lets an admin propose
    // promoting the governor; the governor holds role review but is the target.
    q(
      `insert into private.owner_admin_invitations(email,claimed_by,claimed_at) values(lower('${governor.email}'),'${governor.id}',now());`
    );
    const proposed = json(
      staff(
        admin,
        `select api.propose_frontend_staff_role('${governor.email}','admin','Synthetic administrator promotion');`
      )
    );
    assert.equal(proposed.status, "proposed");
    for (const action of ["approve", "reject"]) {
      fails(
        staff(governor, `select api.review_frontend_staff_role('${proposed.id}','${action}',1);`),
        "42501",
        /independent staff role reviewer required/
      );
    }
    assert.equal(change(proposed.id).status, "proposed");
    assert.equal(role(governor), "governor");
    // The proposer may withdraw it (reject), which applies nothing.
    assert.equal(
      json(staff(admin, `select api.review_frontend_staff_role('${proposed.id}','reject');`))
        .status,
      "withdrawn"
    );
    assert.equal(change(proposed.id).reviewer_id, admin.id);
    assert.equal(role(governor), "governor");
  });

  // ------------------------------------------------------ privacy requests
  const privacy = (id) =>
    json(`select to_jsonb(r) from private.privacy_requests r where r.id='${id}';`);
  const record = (who, type, session = who.session) =>
    json(
      service(
        `select api.record_frontend_privacy_request('${who.id}','${session}','${type}','Fixture Member','0123','Synthetic ${type} request');`
      )
    );
  const processAs = (who, id, revision, action, note = null) =>
    staff(
      who,
      `select api.process_frontend_privacy_request('${id}',${revision},'${action}',${note ? `'${note}'` : "null"});`
    );

  await check("privacy: intake binds the live session and sets the deadline from the rule", () => {
    const nomsa = user("nomsa"),
      other = user("other");
    fails(
      service(
        `select api.record_frontend_privacy_request('${nomsa.id}','${other.session}','access','Fixture Member','0123',null);`
      ),
      "42501",
      /live confirmed account session required/
    );
    const recorded = record(nomsa, "access");
    const r = privacy(recorded.id);
    assert.equal(r.subject_user_id, nomsa.id);
    assert.equal(r.requester_email, nomsa.email);
    assert.equal(r.status, "submitted");
    assert.equal(r.identity_verified, false);
    assert.equal(r.revision, 1);
    assert.equal(
      scalar(
        `select due_by=received_at+make_interval(days=>(select days from private.privacy_request_rules where request_type='access')) from private.privacy_requests where id='${recorded.id}';`
      ),
      "t"
    );
    assert.equal(
      scalar(`select days from private.privacy_request_rules where request_type='access';`),
      "30"
    );
    assert.equal(record(nomsa, "access").reused, true, "an exact retry is acknowledged");
    assert.equal(count(`private.privacy_requests where subject_user_id='${nomsa.id}'`), 1);
    assert.equal(count(`private.privacy_notice_jobs where request_id='${recorded.id}'`), 1);
    // A member cannot read the staff queue.
    fails(member(nomsa, "select api.get_frontend_privacy_queue();"), "42501");
  });

  await check("privacy: one extension only; identity verified before complete or export", () => {
    const sizwe = user("sizwe");
    const id = record(sizwe, "access").id;
    const due = privacy(id).due_by;
    fails(processAs(admin, id, 2, "approve"), "PT409", /privacy request changed/);
    const extended = json(
      processAs(admin, id, 1, "extend", "Review needs the permitted additional time.")
    );
    assert.equal(extended.status, "extended");
    assert.equal(
      scalar(
        `select extended_due_at=due_by+interval '30 days' and due_by='${due}'::timestamptz from private.privacy_requests where id='${id}';`
      ),
      "t"
    );
    fails(
      processAs(admin, id, 2, "extend", "A second extension must not be permitted."),
      "PT409",
      /deadline cannot be extended/
    );
    assert.equal(privacy(id).revision, 2);
    assert.equal(json(processAs(admin, id, 2, "approve")).status, "in_progress");
    fails(processAs(admin, id, 3, "complete"), "PT409", /verified in-progress/);
    fails(
      staff(admin, `select api.export_frontend_privacy_request('${id}',3);`),
      "PT409",
      /represented verified access request required/
    );
    assert.equal(privacy(id).status, "in_progress");
    assert.equal(json(processAs(admin, id, 3, "verify_identity")).status, "identity_verified");
    const verified = privacy(id);
    assert.equal(verified.identity_verified, true);
    assert.equal(verified.verified_by, admin.id);
    const exported = json(staff(admin, `select api.export_frontend_privacy_request('${id}',4);`));
    assert.equal(exported.request_id, id);
    assert.equal(exported.account_found, true);
    assert.equal(exported.datasets.account[0].id, sizwe.id);
    assert.equal(JSON.stringify(exported).includes("encrypted_password"), false);
    assert.equal(json(processAs(admin, id, 4, "complete", "Fulfilled")).status, "completed");
    const done = privacy(id);
    assert.equal(done.status, "completed");
    assert.ok(done.completed_at);
    assert.deepEqual(
      scalar(
        `select string_agg(kind,',' order by created_at,kind) from private.privacy_notice_jobs where request_id='${id}';`
      ).split(","),
      ["submitted", "extended", "completed"]
    );
    assert.equal(
      scalar(
        `select string_agg(action,',' order by occurred_at,action) from private.privacy_request_events where request_id='${id}';`
      ),
      "submitted,extended,started,identity_verified,exported,completed"
    );
    // A request type with no extension in its rule cannot be extended.
    const correction = record(sizwe, "correction").id;
    fails(
      processAs(admin, correction, 1, "extend", "Correction needs more time than the rule."),
      "PT409",
      /deadline cannot be extended/
    );
    assert.equal(privacy(correction).extended_due_at, null);
  });

  await check("privacy: staff cannot process or export their own request", () => {
    const own = record(governor, "access").id;
    fails(
      processAs(governor, own, 1, "approve"),
      "42501",
      /another staff member must process your request/
    );
    assert.equal(privacy(own).status, "submitted");
    q(processAs(admin, own, 1, "approve"));
    q(processAs(admin, own, 2, "verify_identity"));
    fails(
      staff(governor, `select api.export_frontend_privacy_request('${own}',3);`),
      "42501",
      /another staff member must export your request/
    );
    assert.equal(
      count(`private.privacy_request_events where request_id='${own}' and action='exported'`),
      0
    );
    assert.equal(
      json(staff(admin, `select api.export_frontend_privacy_request('${own}',3);`)).datasets
        .account[0].id,
      governor.id
    );
    // A request recorded by staff for the governor's email address is theirs
    // too, before any account is matched to it.
    const intake = json(
      staff(
        admin,
        `select api.record_frontend_privacy_intake('access','${governor.email}',null,'Emailed access request for a staff account','Recorded from the privacy mailbox');`
      )
    ).id;
    assert.equal(privacy(intake).subject_user_id, null);
    fails(
      processAs(governor, intake, 1, "verify_identity"),
      "42501",
      /another staff member must process your request/
    );
    assert.equal(privacy(intake).identity_verified, false);
  });

  // ----------------------------------------- report actions and appeals
  const report = (id) => json(`select to_jsonb(r) from private.reports r where r.id='${id}';`);
  const postRow = (id) =>
    json(`select to_jsonb(p)-'title'-'description' from private.posts p where p.id='${id}';`);
  const isPublic = (id) =>
    scalar(`select exists(select 1 from private.public_eligible_posts where id='${id}');`) === "t";
  let hmac = 0;
  const submitReport = (post, reason, reporter = null) =>
    json(
      service(
        `select api.submit_frontend_report('${post}','promotion','${reason}','A synthetic report description','${String(++hmac).padStart(43, "x")}',${reporter ? `'${reporter.id}'` : "null"});`
      )
    ).id;
  const claimReport = (who, id) =>
    json(staff(who, `select api.claim_queue_item('report','${id}');`));
  const act = (who, id, lease, action, reason, postRevision = null, revision = null) =>
    staff(
      who,
      `select api.execute_frontend_report_action_v2('${id}',${revision ?? report(id).revision},'${lease.claim_generation}','${lease.claim_nonce}','${action}','${reason}',null,false,${postRevision ?? "null"});`
    );
  const owner = user("owner"),
    reporter = user("reporter");
  q(`insert into vmtest.verified values('${owner.id}');`);
  const event = livePost(owner);
  assert.equal(isPublic(event), true);
  let warningReceipt;

  await check("reports: staff cannot review a report they made or are the subject of", () => {
    const own = livePost(governor);
    const aboutGovernor = submitReport(own, "spam", reporter);
    fails(
      staff(governor, `select api.claim_queue_item('report','${aboutGovernor}');`),
      "42501",
      /self-review is not allowed/
    );
    const byGovernor = submitReport(event, "misleading", governor);
    fails(
      staff(governor, `select api.claim_queue_item('report','${byGovernor}');`),
      "42501",
      /self-review is not allowed/
    );
    assert.equal(
      count(`private.queue_claims where report_id in('${aboutGovernor}','${byGovernor}')`),
      0
    );
  });

  await check("reports: a warning notifies the owner once and leaves the account open", () => {
    const id = submitReport(event, "spam", reporter);
    const lease = claimReport(moderator, id);
    fails(act(moderator, id, lease, "warn", "short"), "22023");
    const revision = report(id).revision;
    fails(
      act(moderator, id, lease, "warn", "Synthetic account warning", null, revision - 1),
      "PT409"
    );
    assert.equal(report(id).status, "open");
    const warned = json(
      act(moderator, id, lease, "warn", "Synthetic account warning", null, revision)
    );
    assert.equal(warned.status, "applied");
    const r = report(id);
    assert.equal(r.status, "resolved");
    assert.equal(r.resolved_by, moderator.id);
    warningReceipt = scalar(
      `select id from private.frontend_report_action_receipts where report_id='${id}' and action='warn';`
    );
    assert.equal(count(`private.frontend_account_warnings where account_id='${owner.id}'`), 1);
    assert.equal(
      count(`private.notifications where account_id='${owner.id}' and kind='account_warning'`),
      1
    );
    assert.equal(
      count(
        `private.outbox_events where owner_id='${owner.id}' and kind='account_warning' and subject_id='${warningReceipt}'`
      ),
      1
    );
    // The exact retry is acknowledged without a second notice.
    const retry = json(
      act(moderator, id, lease, "warn", "Synthetic account warning", null, revision)
    );
    assert.equal(retry.reused, true);
    assert.equal(
      count(`private.notifications where account_id='${owner.id}' and kind='account_warning'`),
      1
    );
    assert.equal(count(`private.outbox_events where kind='account_warning'`), 1);
    assert.equal(count(`private.current_account_access where id='${owner.id}'`), 1);
    assert.equal(isPublic(event), true, "a warning does not hide the post");
  });

  let hold;
  await check(
    "reports: hiding needs a hide-capable reviewer, the reviewed revision and a reason",
    () => {
      const id = submitReport(event, "scam");
      const revision = report(id).revision;
      const before = postRow(event).revision;
      const moderatorLease = claimReport(moderator, id);
      fails(
        act(moderator, id, moderatorLease, "hide", "Synthetic content removal", before, revision),
        "42501",
        /capability not granted/
      );
      q(staff(moderator, "select api.control_my_frontend_staff_claims('release');"));
      const lease = claimReport(governor, id);
      fails(
        act(governor, id, lease, "hide", "Synthetic content removal", before + 1, revision),
        "PT409",
        /reviewed report or target changed/
      );
      fails(act(governor, id, lease, "hide", "too short", before, revision), "22023");
      assert.equal(postRow(event).status, "live");
      assert.equal(count(`private.frontend_content_holds where post_id='${event}'`), 0);
      assert.equal(
        json(act(governor, id, lease, "hide", "Synthetic content removal", before, revision))
          .status,
        "applied"
      );
      const hidden = postRow(event);
      assert.equal(hidden.status, "paused");
      assert.equal(hidden.status_reason, "staff_hidden");
      assert.equal(hidden.revision, before + 1);
      assert.equal(isPublic(event), false);
      const holds = json(
        `select jsonb_agg(to_jsonb(h)) from private.frontend_content_holds h where h.post_id='${event}';`
      );
      assert.equal(holds.length, 1);
      hold = holds[0].id;
      assert.equal(holds[0].actor_id, governor.id);
      assert.equal(holds[0].account_id, owner.id);
      assert.equal(holds[0].released_at, null);
      assert.equal(report(id).status, "resolved");
      // The exact retry is acknowledged; nothing is written twice.
      assert.equal(
        json(act(governor, id, lease, "hide", "Synthetic content removal", before, revision))
          .reused,
        true
      );
      assert.equal(count(`private.frontend_content_holds where post_id='${event}'`), 1);
      // The reviewer who hid it cannot restore it.
      fails(
        staff(
          governor,
          `select api.release_frontend_content_hold('${hold}',1,'Self restoration');`
        ),
        "42501",
        /independent restoration reviewer required/
      );
      assert.equal(isPublic(event), false);
    }
  );

  await check("appeals: the owner appeals once; an independent reviewer overturns the hold", () => {
    assert.ok(hold, "the hide check must run first");
    const reason = "A synthetic explanation for why this content should be reviewed again";
    fails(member(owner, `select api.submit_my_frontend_appeal('${hold}','Too short');`), "22023");
    fails(
      member(reporter, `select api.submit_my_frontend_appeal('${hold}','${reason}');`),
      "PT409",
      /decision cannot be appealed/
    );
    const submitted = json(
      member(owner, `select api.submit_my_frontend_appeal('${hold}','${reason}');`)
    );
    assert.equal(submitted.status, "submitted");
    const appeal = submitted.appeal_id;
    assert.equal(
      json(member(owner, `select api.submit_my_frontend_appeal('${hold}','${reason}');`)).reused,
      true
    );
    assert.equal(count(`private.frontend_appeals where action_id='${hold}'`), 1);
    const resolve = (who, outcome, version = 1) =>
      staff(
        who,
        `select api.resolve_frontend_appeal('${appeal}','${outcome}','Synthetic independent appeal review',${version});`
      );
    // The reviewer who hid the post cannot decide its appeal; a moderator has
    // no appeal capability.
    fails(resolve(governor, "upheld"), "42501", /independent appeal reviewer required/);
    fails(resolve(moderator, "upheld"), "42501", /capability not granted/);
    fails(resolve(admin, "overturned", 2), "PT409", /appeal effect changed/);
    assert.equal(
      scalar(`select status from private.frontend_appeals where id='${appeal}';`),
      "submitted"
    );
    assert.equal(isPublic(event), false);
    const overturned = json(resolve(admin, "overturned"));
    assert.equal(overturned.status, "overturned");
    const decided = json(
      `select to_jsonb(a) from private.frontend_appeals a where a.id='${appeal}';`
    );
    assert.equal(decided.status, "overturned");
    assert.equal(decided.reviewer_id, admin.id);
    assert.ok(decided.resolved_at);
    const released = json(
      `select to_jsonb(h) from private.frontend_content_holds h where h.id='${hold}';`
    );
    assert.equal(released.released_by, admin.id);
    assert.equal(released.version, 2);
    assert.equal(released.restored, true);
    const restored = postRow(event);
    assert.equal(restored.status, "live");
    assert.equal(isPublic(event), true);
    assert.equal(json(resolve(admin, "overturned")).reused, true);
    fails(resolve(admin2, "upheld"), "PT409", /appeal already resolved/);
    // A warning is appealable too; upholding it changes nothing else.
    const warningAppeal = json(
      member(owner, `select api.submit_my_frontend_appeal('${warningReceipt}','${reason}');`)
    ).appeal_id;
    assert.equal(
      json(
        staff(
          admin2,
          `select api.resolve_frontend_appeal('${warningAppeal}','upheld','Synthetic review upheld the warning',null);`
        )
      ).status,
      "upheld"
    );
    assert.equal(count(`private.frontend_account_warnings where account_id='${owner.id}'`), 1);
  });

  // ------------------------------------------------ outbox lease fencing
  await check("mail outbox: a stale or foreign lease cannot acknowledge a delivery", () => {
    const claim = () =>
      json(service("select api.claim_supported_notification_outbox(array['account_warning'],5);"));
    const complete = (id, token, ok = true) =>
      scalar(service(`select api.complete_notification_outbox('${id}','${token}',${ok},null);`));
    const first = claim();
    assert.equal(first.length, 1);
    const [{ id, claim_token: firstToken }] = first;
    assert.equal(first[0].attempts, 1);
    assert.equal(first[0].recipient, owner.email);
    assert.equal(first[0].notice_reason, "Synthetic account warning");
    assert.deepEqual(claim(), [], "a leased delivery is not handed out twice");
    assert.equal(complete(id, "00000000-0000-4000-8000-000000000000"), "f");
    // The lease runs out (90 seconds), simulated by moving its end back.
    q(
      `update private.outbox_events set delivery_until=clock_timestamp()-interval '1 second' where id='${id}';`
    );
    assert.equal(complete(id, firstToken), "f", "an expired lease cannot acknowledge");
    const second = claim();
    assert.equal(second.length, 1);
    assert.equal(second[0].id, id);
    assert.equal(second[0].attempts, 2);
    assert.notEqual(second[0].claim_token, firstToken);
    assert.equal(complete(id, firstToken), "f", "the first worker's lease is fenced off");
    assert.equal(
      scalar(`select processed_at is null from private.outbox_events where id='${id}';`),
      "t"
    );
    assert.equal(complete(id, second[0].claim_token), "t");
    assert.equal(complete(id, second[0].claim_token), "f", "an acknowledgement applies once");
    assert.equal(
      scalar(
        `select processed_at is not null and delivery_claim is null from private.outbox_events where id='${id}';`
      ),
      "t"
    );
    assert.deepEqual(claim(), []);
    fails(
      member(owner, "select api.claim_supported_notification_outbox(array['account_warning'],5);"),
      "42501"
    );
  });

  // ---------------------------------------------- activation limit per period
  await check("activations: the per-period limit holds even with free slots", () => {
    const mandla = user("mandla");
    const entitlement =
      scalar(`insert into private.entitlements(owner_id,source,granted_by,slot_capacity,max_photos,max_videos,
        starts_at,ends_at,activations_per_period,activation_period_days)
      values('${mandla.id}','staff_grant','${admin.id}',3,10,1,now()-interval '1 day',now()+interval '60 days',1,30)
      returning id;`);
    const first = scalar(`select vmtest.post('${mandla.id}','listing',false);`);
    const second = scalar(`select vmtest.post('${mandla.id}','listing',false);`);
    const activate = (post) => member(mandla, `select api.activate_post('${post}');`);
    const activated = json(activate(first));
    assert.equal(activated.entitlement_id, entitlement);
    assert.equal(activated.reused, false);
    fails(activate(second), "PT409", /all posting capacity is in use/);
    // Releasing the first slot frees capacity but not the period's budget
    // (released directly, as ending the post would).
    q(
      `update private.post_activations set released_at=clock_timestamp(),release_reason='owner' where post_id='${first}';`
    );
    fails(activate(second), "PT409", /all posting capacity is in use/);
    assert.equal(count(`private.post_activations where post_id='${second}'`), 0);
    // Once that activation is older than the period, a new one is allowed.
    q(
      `update private.post_activations set activated_at=activated_at-interval '31 days' where post_id='${first}';`
    );
    assert.equal(json(activate(second)).entitlement_id, entitlement);
    assert.equal(
      count(`private.post_activations where post_id='${second}' and released_at is null`),
      1
    );
  });
} catch (error) {
  console.error(`FAIL ${current}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Foundation staff rule checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
