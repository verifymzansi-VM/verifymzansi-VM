#!/usr/bin/env node
// Behaviour checks for 20261116175757_close_and_erase_account.sql: closing an
// account and erasing it 30 days later (roadmap M1.6b, owner decision OD-10).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members act as `authenticated` with synthetic claims and a live session
// row (a recent sign-in is an `amr` entry); staff act with a verified
// authenticator app and an AAL2 session; the retention job, the media cleanup,
// the privacy notices and Ozow's notices run as `service_role`. Time is moved by
// shifting a closed account's dates back (vmtest.erasure_due). Stand-ins for
// hosted Auth tables the prelude does not model (auth.identities,
// auth.refresh_tokens) are created so their clean-up is observed. Fixture rows
// the product creates through longer flows (an organisation, a sponsored place,
// a business check, a report, content holds, a partner) are written as the
// database owner.
//
// It checks the read-only preflight (with the Auth privileges the erasure
// needs) and the update's refusals, apply -> rollback -> apply, the grants;
// closing (recent sign-in, own live session, never staff; posts hidden at
// once, sign-in blocked, sessions ended, a deletion request due 7 days after
// the grace period, a replay refused); nothing erased before 30 days; the
// second-person rule; each hold in turn (legal hold, staff content hold, open
// report, unpaid invoice, unpaid partner commission, rejected request) makes
// the erasure wait until it ends; the erasure deletes posts with their edit
// copy, sponsored place, event submission, business check, organisation role,
// sent and received enquiries, profile and consent records, queues the media,
// and keeps every payment, grant, invoice, bank transfer and partner
// commission with no person; the record guards still refuse any other change;
// after the erasure a chargeback reverses the partner's commission, a refund
// over R1,000 is approved by a second staff member and a late Ozow payment of
// the erased account is accepted and refunded; an unverified account's Auth
// user is deleted after the media cleanup, while kept verification history, an
// identity ban or a partner record keeps an empty Auth row; the completed
// notice reaches the address on the request after the erasure, and the request
// is then minimised; a failing account is recorded with its error and never
// stops the sweep, and a failed Auth delete never undoes an erasure; the
// runbook's interim command; replays; the rollback refusal.
//
//   node --import tsx scripts/test-foundation-account-erasure.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow or sends email.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertReadOnlyPreflight,
  completeSlotOrder,
  installStaffPaymentWorld,
  openUpdateCheck,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261116175757_close_and_erase_account.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const P30 = { id: "d6ca48e5-43be-40df-8d8c-72c98a6fda96", cents: 6900 };
const ROLES = ["anon", "authenticated", "service_role"];
const COMMANDS = {
  "api.close_my_account()": ["authenticated"],
  "api.fulfil_account_deletion(uuid,integer)": ["authenticated"],
  "api.get_account_erasure(uuid)": ["authenticated"],
};
const CLOSED_TO_API = [
  "internal.erasure_unlinks(jsonb,jsonb,text[])",
  "internal.account_closing_actor()",
  "internal.account_erasure_hold(uuid)",
  "internal.account_erasure_state(uuid)",
  "internal.end_account_sessions(uuid)",
  "internal.close_account_now(uuid,text,uuid)",
  "internal.reject_account_erasure(uuid,uuid)",
  "internal.remove_account_sign_in(uuid)",
  "internal.remove_erased_auth_user(uuid)",
  "internal.erase_closed_account(uuid,text)",
  "internal.order_account_erasure(uuid,integer,uuid)",
  "internal.run_account_erasures(integer)",
  "internal.outbox_skip_unlinked()",
  "internal.lock_kept_record_subject(uuid,uuid)",
  "internal.retention_privacy_requests(integer)",
];
const fingerprintOf = (label) =>
  `${createHash("sha256").update(`person-${label}`).digest("base64url").slice(0, 42)}A`;

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
  service,
  fingerprint,
  preflightRows: preflight,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const count = (sql) => Number(q(`select count(*) from ${sql};`));
  const truth = (sql) => q(`select (${sql});`) === "t";
  const callers = (sig) =>
    ROLES.filter(
      (role) => q(`select has_function_privilege('${role}','${sig}','execute');`) === "t"
    );
  const asOwner = (sql) =>
    q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);

  // ------------------------------------------------------- synthetic world
  const { user, staffUser, verify } = installStaffPaymentWorld(q, json);
  q(`create table if not exists auth.identities(id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade, provider text not null);
    create table if not exists auth.refresh_tokens(id bigserial primary key, user_id varchar(255),
      session_id uuid references auth.sessions(id) on delete cascade, token text);
    create function vmtest.post(p_owner uuid,p_kind text,p_area text) returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); cat text; begin
      select c.category_key into cat from private.post_category_contracts c
        where c.kind=p_kind and c.area=p_area order by c.category_key limit 1;
      insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
        values(pid,p_owner,p_kind,p_area,cat,(select a.key from private.category_activities a join private.categories c on c.key=a.category_key
          where a.category_key=cat and c.activity_required order by a.key limit 1),
          'Fixture '||p_kind||' '||left(pid::text,8),'A synthetic description long enough for every rule.','gp','gp_johannesburg');
      if p_kind='listing' then insert into private.listing_details(post_id,price_mode,price_cents) values(pid,'amount',12000);
      elsif p_kind='business' then insert into private.business_details(post_id) values(pid); end if;
      return pid;
    end$$;
    create function vmtest.media(p_owner uuid) returns uuid language plpgsql as $$
    declare mid uuid:=gen_random_uuid(); begin
      insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,state,created_at)
        values(mid,p_owner,'image','media/'||mid,1000,1000,repeat('a',64),'image/jpeg','ready',now()-interval '3 days');
      return mid;
    end$$;
    create function vmtest.enquiry(p_post uuid,p_sender uuid) returns uuid language plpgsql as $$
    declare eid uuid:=gen_random_uuid(); owner uuid; begin
      select owner_id into owner from private.posts where id=p_post;
      perform set_config('session_replication_role','replica',true);
      insert into private.enquiries(id,request_id,post_id,owner_id,sender_account_id,buyer_name,buyer_email,email_confirmed,
          message,status,created_at,updated_at,retain_until)
        values(eid,gen_random_uuid(),p_post,owner,p_sender,'Fixture Buyer','buyer@example.com',true,
          'Is this still available please?','new',now(),now(),now()+interval '1 year');
      insert into private.notifications(account_id,kind,subject_id,post_id) values(owner,'enquiry_received',eid,p_post);
      insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values('enquiry_received',eid,owner,'enquiry:'||eid);
      perform set_config('session_replication_role','origin',true);
      return eid;
    end$$;
    create function vmtest.sign_in_records(p_user uuid,p_session uuid) returns void language plpgsql as $$
    begin
      insert into auth.identities(user_id,provider) values(p_user,'email');
      insert into auth.refresh_tokens(user_id,session_id,token) values(p_user::text,p_session,md5(random()::text));
      insert into auth.refresh_tokens(user_id,token) values(p_user::text,md5(random()::text));
      insert into auth.audit_log_entries(id,payload,created_at)
        values(gen_random_uuid(),json_build_object('actor_id',p_user::text,'action','login'),now());
    end$$;
    -- Thirty-one days pass for one closed account (and two hours for a recorded wait).
    create function vmtest.erasure_due(p_user uuid) returns void language plpgsql as $$
    begin
      update private.account_erasures set closed_at=closed_at-interval '31 days',erase_after=erase_after-interval '31 days',
        blocked_at=blocked_at-interval '2 hours' where user_id=p_user;
      update private.account_closures set closed_at=closed_at-interval '31 days',
        evidence_delete_after=evidence_delete_after-interval '31 days' where user_id=p_user;
    end$$;
    create function vmtest.an_hour_later(p_user uuid) returns void language plpgsql as $$
    begin
      update private.account_erasures set blocked_at=blocked_at-interval '2 hours' where user_id=p_user;
    end$$;
    create function vmtest.a_day_later(p_user uuid) returns void language plpgsql as $$
    begin
      update private.account_erasures set auth_checked_at=auth_checked_at-interval '2 days' where user_id=p_user;
    end$$;`);

  const admin = staffUser("erase-admin", "admin");
  const admin2 = staffUser("erase-admin2", "admin");
  const moderator = staffUser("erase-moderator", "moderator");
  verify(admin, admin2, "erase-admin");
  verify(admin2, admin, "erase-admin2");
  const today = q("select to_char((now() at time zone 'Africa/Johannesburg')::date,'YYYY-MM-DD');");
  const now = () => Math.floor(Date.now() / 1000);
  /** A member session that signed in `ago` seconds earlier. */
  const signedIn = (person, sql, ago = 60) =>
    as({ ...claims(person), amr: [{ method: "password", timestamp: now() - ago }] }, sql);
  const close = (person) => json(signedIn(person, "select api.close_my_account();"));
  const erasureOf = (person) =>
    json(
      `select coalesce((select to_jsonb(e) from private.account_erasures e where e.user_id='${person.id}'),'null');`
    );
  const retention = () => json(service("select api.run_retention(100);"));
  const sweep = () => retention().accounts;
  /** The sweep after a recorded wait has aged; returns the erasure row. */
  const retry = (person) => {
    q(`select vmtest.an_hour_later('${person.id}');`);
    sweep();
    return erasureOf(person);
  };
  const revisionOf = (id) => q(`select revision from private.privacy_requests where id='${id}';`);
  const privacy = (who, id, action, extra = "") =>
    staff(
      who,
      `select api.process_frontend_privacy_request('${id}',${revisionOf(id)},'${action}'${extra});`
    );
  const fulfil = (who, id) =>
    staff(who, `select api.fulfil_account_deletion('${id}',${revisionOf(id)});`);
  const complete = (who, id) =>
    privacy(who, id, "complete", ",'Done',null,'Erased the account under the deletion rules.'");
  const emailedRequest = (person, text = "Please delete my account.") => {
    const email = q(`select email from auth.users where id='${person.id}';`);
    return q(`insert into private.privacy_requests(type,requester_email,description,identity_check,
        received_at,due_by,legal_basis) values('deletion','${email}','${text}','manual',
        now(),now()+interval '30 days','Internal response target for a deletion request.') returning id;`);
  };
  const authRow = (person) =>
    json(`select coalesce((select jsonb_build_object('email',email,'phone',phone,'banned',banned_until>now()+interval '50 years',
        'deleted',deleted_at is not null,'meta',raw_user_meta_data) from auth.users where id='${person.id}'),'null');`);
  const signInLeft = (person) =>
    count(`auth.sessions where user_id='${person.id}'`) +
    count(`auth.refresh_tokens where user_id='${person.id}'`) +
    count(`auth.identities where user_id='${person.id}'`) +
    count(`auth.mfa_factors where user_id='${person.id}'`) +
    count(`auth.audit_log_entries where payload->>'actor_id'='${person.id}'`);
  const publicPost = (id) =>
    truth(`exists(select 1 from private.public_eligible_posts where id='${id}')`);
  const providerEvent = (paymentId, status, key) => {
    const row = json(
      `select jsonb_build_object('ref',merchant_reference,'amount',amount_cents) from private.payments where id='${paymentId}';`
    );
    const event = {
      payload_sha256: createHash("sha256").update(`event-${paymentId}-${key}`).digest("hex"),
      merchant_reference: row.ref,
      provider_request_id: `req-${paymentId}`,
      provider_transaction_id: `tx-${paymentId}`,
      status,
      amount_cents: Number(row.amount),
      currency: "ZAR",
    };
    return json(service(`select api.apply_provider_event($e$${JSON.stringify(event)}$e$::jsonb);`));
  };

  // The payer: a verified member with a paid slot (referred by a partner, so a
  // commission is pending), a live post with a photo and an edit copy, an
  // enquiry received, a business post with a business check, an organisation
  // role and a waiting sponsored place, an event submission, a released staff
  // content hold, an invoice paid by bank transfer, an unpaid invoice, a
  // checkout that expired at Ozow, and a sign-in through email.
  const payer = user("erase-payer");
  verify(payer, admin, "erase-payer");
  q(`select vmtest.sign_in_records('${payer.id}','${payer.session}');`);
  const payerEmail = q(`select email from auth.users where id='${payer.id}';`);
  // A staff-raised slot limit (kept, unlinked, by the erasure).
  q(`insert into private.individual_slot_limits(identity_hmac,account_id,slot_limit,ends_at,reason,granted_by)
     values('${fingerprintOf("erase-payer")}','${payer.id}',8,now()+interval '60 days','Fixture raised limit','${admin.id}');`);
  const order = completeSlotOrder({ q, json, member, service }, payer, P30, 1).id;
  const late = json(
    member(payer, `select api.start_slot_checkout('${P30.id}',1,${P30.cents},true);`)
  ).payment_id;
  const lease = json(service(`select api.claim_checkout_request('${late}','${payer.id}');`));
  q(
    service(
      `select api.complete_checkout_request('${late}','${payer.id}','${lease.claim_token}','req-${late}','https://one.ozow.com/checkout/req-${late}');`
    )
  );
  asOwner(
    `update private.payments set status='expired',status_changed_at=now() where id='${late}';`
  );
  const paidInvoice = json(
    staff(
      admin,
      `select api.issue_staff_invoice('${payerEmail}',180,3,7,'Invoice requested by email','${randomUUID()}');`
    )
  );
  const transfer = json(
    staff(
      admin,
      `select api.record_staff_invoice_transfer('${paidInvoice.invoice_number}','ERASE-EFT-1','${today}',true,'EFT cleared; written waiver on file');`
    )
  );
  const invoicePayment = json(
    staff(admin2, `select api.confirm_staff_invoice_payment('${transfer.transfer_id}');`)
  ).payment_id;
  const unpaidInvoice = json(
    staff(
      admin,
      `select api.issue_staff_invoice('${payerEmail}',30,1,7,'Invoice requested by email','${randomUUID()}');`
    )
  );
  const paidPost = q(`select vmtest.post('${payer.id}','listing','market');`);
  json(member(payer, `select api.activate_post('${paidPost}');`));
  q(`update private.posts set status='live',published_at=now(),
       visible_until=(select f.funded_until from internal.post_funding('${paidPost}') f) where id='${paidPost}';
     select internal.write_post_projection('${paidPost}');`);
  const paidPhoto = q(`select vmtest.media('${payer.id}');`);
  q(
    `insert into private.post_media(post_id,object_id,purpose,"position") values('${paidPost}','${paidPhoto}','cover',0);`
  );
  const editCopy = json(
    member(
      payer,
      `select api.create_post_edit('${paidPost}',${q(`select revision from private.posts where id='${paidPost}';`)});`
    )
  );
  const businessPost = q(`select vmtest.post('${payer.id}','business','business');`);
  const partnerPerson = user("erase-partner");
  asOwner(`
     insert into private.partners(account_id,code,status,commission_bps,created_by)
       values('${partnerPerson.id}','ERASE1','active',2000,'${admin.id}');
     insert into private.partner_commissions(partner_id,payment_id,referred_account_id,base_cents,rate_bps,amount_cents,status,eligible_at)
       select p.id,'${order}','${payer.id}',6900,2000,1380,'pending',now()+interval '30 days' from private.partners p where p.code='ERASE1';
     insert into private.organisations(id,slug,name) values('${randomUUID()}','erase-org','Erase Fixture Organisation');
     insert into private.organisation_admins(organisation_id,account_id,role)
       select id,'${payer.id}','owner' from private.organisations where slug='erase-org';
     with a as (insert into private.organisation_affiliations(organisation_id,post_id,confirmed_by)
       select id,'${businessPost}','${admin.id}' from private.organisations where slug='erase-org' returning id,organisation_id)
     insert into private.organisation_sponsorships(organisation_id,affiliation_id,post_id,owner_id,sponsor_type,status,requested_by)
       select organisation_id,id,'${businessPost}','${payer.id}','organisation','waitlisted','${admin.id}' from a;
     insert into private.frontend_business_checks(id,business_id,owner_id,kind) values('${randomUUID()}','${businessPost}','${payer.id}','cipc');
     insert into private.event_submissions(owner_id,post_id,submitted_at) values('${payer.id}','${paidPost}',now()-interval '40 days');
     insert into private.slot_packages(owner_id,term_days,slot_count) values('${payer.id}',30,5);
     insert into private.frontend_content_holds(id,post_id,account_id,reason,applied_at,released_at,release_reason,released_by)
       values(gen_random_uuid(),'${businessPost}','${payer.id}','A synthetic released staff hold',now()-interval '2 days',now()-interval '1 day',
         'Checked and fine','${admin.id}');`);
  // A member who never verified: a draft post with a photo, an avatar, and an
  // enquiry sent to the payer's post.
  const plain = user("erase-plain");
  q(`select vmtest.sign_in_records('${plain.id}','${plain.session}');`);
  const plainEmail = q(`select email from auth.users where id='${plain.id}';`);
  const plainPost = q(`select vmtest.post('${plain.id}','listing','market');`);
  const plainPhoto = q(`select vmtest.media('${plain.id}');`);
  const avatar = q(`select vmtest.media('${plain.id}');`);
  q(
    `insert into private.post_media(post_id,object_id,purpose,"position") values('${plainPost}','${plainPhoto}','cover',0);`
  );
  asOwner(`insert into private.profiles(account_id) values('${plain.id}') on conflict do nothing;
     update private.profiles set avatar_object_id='${avatar}',bio='A short fixture bio.' where account_id='${plain.id}';`);
  const sentEnquiry = q(`select vmtest.enquiry('${paidPost}','${plain.id}');`);
  // A banned member: an approved account restriction with its identity-ban
  // fingerprint.
  const banned = user("erase-banned");
  asOwner(`
     with c as (insert into private.evidence_cases(subject_id,kind,status) values('${banned.id}','restriction','decided') returning id),
     d as (insert into private.decisions(case_id,action,payload,case_version,reviewed_snapshot,proposed_by,proposed_at,
         approved_by,approved_at,status,scope_kind)
       select c.id,'restrict_account','{}'::jsonb,1,'[]'::jsonb,'${admin.id}',now(),'${admin2.id}',now(),'approved','native' from c
       returning id)
     insert into private.banned_identities(identity_hmac,decision_id,category,banned_at,retain_until)
       select '${fingerprintOf("erase-banned")}',d.id,'fraud',now(),now()+interval '5 years' from d;`);

  // ------------------------------------------------------------ before
  await check("before the update: the preflight reads 'not applied'", () => {
    assertReadOnlyPreflight(database, PREFLIGHT);
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], /^close and erase accounts: update not applied/);
  });

  await check("the preflight names an Auth change the function owner may not make", () => {
    // The container's postgres is a superuser (every privilege); hosted
    // Supabase's is not. A function owner that may only delete sessions.
    const owned = "internal.close_account_evidence(uuid)";
    q(`create role vmtest_owner nologin;
      grant select, delete on auth.sessions to vmtest_owner;
      alter function ${owned} owner to vmtest_owner;`);
    try {
      const problems = preflight()
        .filter((r) => r[0] === "problem")
        .map((r) => r[1]);
      assert.ok(
        problems.some((p) => /lacks UPDATE on auth\.users/.test(p)),
        problems.join("\n")
      );
      assert.ok(problems.some((p) => /lacks DELETE on auth\.mfa_factors/.test(p)));
      assert.ok(
        !problems.some((p) => /on auth\.sessions/.test(p)),
        "a granted change is not named"
      );
      // Row level security on an Auth table would hide its rows from that owner.
      q("alter table auth.sessions enable row level security;");
      assert.ok(
        preflight().some(
          (r) => r[0] === "problem" && /auth\.sessions has row level security/.test(r[1])
        )
      );
    } finally {
      q(`alter table auth.sessions disable row level security;
        alter function ${owned} owner to postgres;
        revoke all on auth.sessions from vmtest_owner;
        drop role vmtest_owner;`);
    }
    assert.deepEqual(
      preflight().map((r) => r[0]),
      ["summary"]
    );
  });

  await check("the update refuses when a body it replaces or builds on was changed", () => {
    const before = fingerprint();
    for (const sig of [
      "internal.run_retention(integer)",
      "internal.record_staff_payment_refund(uuid,text,text,text,text)",
      "internal.close_account_evidence(uuid)",
    ]) {
      const original = q(`select pg_get_functiondef('${sig}'::regprocedure);`);
      q(original.replace(/\$function\$\n/, "$function$\n-- drifted\n"));
      assert.match(fails(step.sql, "55000"), /account erasure precondition/);
      assert.ok(
        preflight().some((r) => r[0] === "problem" && r[1].includes(sig)),
        sig
      );
      q(original);
    }
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  await check("apply, roll back and apply again are clean", () =>
    applyWithRollbackCheck(database, {
      step,
      rollback: ROLLBACK,
      label: "close and erase accounts",
      fingerprint,
      preflightRows: preflight,
      appliedSummary:
        /^close and erase accounts: already applied; accounts closed: 0; erased: 0; waiting with a hold: 0$/,
      repeatRollback: true,
    })
  );

  await check("only the three commands are open to an API role", () => {
    for (const [sig, roles] of Object.entries(COMMANDS)) assert.deepEqual(callers(sig), roles, sig);
    for (const sig of CLOSED_TO_API) assert.deepEqual(callers(sig), [], sig);
    fails(`set role anon;\nselect api.close_my_account();`, "42501");
    fails(service("select api.close_my_account();"), "42501");
  });

  // ------------------------------------------------------------- closing
  await check("closing needs a recent sign-in, the live session and a member account", () => {
    assert.match(
      fails(member(plain, "select api.close_my_account();"), "42501"),
      /recent_sign_in_required/
    );
    assert.match(
      fails(signedIn(plain, "select api.close_my_account();", 20 * 60), "42501"),
      /recent_sign_in_required/
    );
    fails(
      signedIn({ ...plain, session: payer.session }, "select api.close_my_account();"),
      "42501"
    );
    assert.match(
      fails(signedIn(admin, "select api.close_my_account();"), "42501"),
      /staff_account/
    );
    assert.equal(count("private.account_erasures"), 0);
  });

  let payerRequest;
  await check("closing hides the posts at once, blocks sign-in and schedules the erasure", () => {
    assert.ok(publicPost(paidPost), "the paid post is public before");
    const closed = close(payer);
    assert.equal(closed.status, "closed");
    payerRequest = closed.request_id;
    assert.equal(publicPost(paidPost), false, "hidden at once");
    assert.equal(count(`private.posts where id='${paidPost}'`), 1, "kept until the erasure");
    assert.equal(count(`private.account_closures where user_id='${payer.id}'`), 1);
    assert.equal(count(`auth.sessions where user_id='${payer.id}'`), 0);
    assert.equal(count(`auth.refresh_tokens where user_id='${payer.id}'`), 0);
    assert.equal(authRow(payer).banned, true);
    const erasure = erasureOf(payer);
    assert.equal(erasure.closed_by, "member");
    assert.ok(
      truth(
        `'${erasure.erase_after}'::timestamptz='${erasure.closed_at}'::timestamptz+interval '30 days'`
      )
    );
    assert.ok(erasure.paid_until, "the paid time left is recorded for a cancellation credit");
    const request = json(
      `select to_jsonb(r) from private.privacy_requests r where id='${payerRequest}';`
    );
    assert.equal(request.type, "deletion");
    assert.equal(request.identity_check, "session");
    assert.equal(request.subject_user_id, payer.id);
    assert.ok(
      truth(
        `'${request.due_by}'::timestamptz='${erasure.erase_after}'::timestamptz+interval '7 days'`
      ),
      "due 7 days after the grace period"
    );
    assert.equal(
      count(`private.privacy_notice_jobs where request_id='${payerRequest}' and kind='submitted'`),
      1
    );
    // The same request again: the session it came from has ended.
    fails(signedIn(payer, "select api.close_my_account();"), "42501");
    assert.equal(count(`private.privacy_requests where subject_user_id='${payer.id}'`), 1);
  });

  await check("nothing is erased before 30 days, by the sweep or by staff", () => {
    assert.equal(sweep().erased, 0);
    q(privacy(admin, payerRequest, "verify_identity"));
    q(privacy(admin, payerRequest, "approve"));
    assert.match(fails(fulfil(admin, payerRequest), "42501"), /second_person_required/);
    fails(member(plain, `select api.fulfil_account_deletion('${payerRequest}',3);`), "42501");
    fails(fulfil(moderator, payerRequest), "42501");
    const ordered = json(fulfil(admin2, payerRequest));
    assert.equal(ordered.status, "scheduled");
    assert.equal(count(`private.posts where owner_id='${payer.id}'`), 3);
    assert.match(fails(complete(admin2, payerRequest), "PT409"), /erasure_pending/);
    const read = json(staff(admin2, `select api.get_account_erasure('${payerRequest}');`));
    assert.equal(read.status, "scheduled");
    assert.equal(read.linked, "member_closed");
    fails(member(plain, `select api.get_account_erasure('${payerRequest}');`), "42501");
  });

  await check("each hold makes the erasure wait until it ends", () => {
    // A legal hold, and staff cannot erase past it either.
    json(staff(admin, `select api.place_legal_hold('${payer.id}','Court order pending review');`));
    q(`select vmtest.erasure_due('${payer.id}');`);
    const run = sweep();
    assert.deepEqual([run.erased, run.held], [0, 1]);
    const read = json(staff(admin2, `select api.get_account_erasure('${payerRequest}');`));
    assert.deepEqual([read.status, read.held_by], ["held", "legal_hold"]);
    assert.equal(json(fulfil(admin2, payerRequest)).status, "held");
    asOwner(
      `update private.legal_holds set released_at=now(),released_by='${admin.id}' where subject_id='${payer.id}';`
    );
    assert.equal(sweep().erased, 0, "a recorded wait is retried after an hour");
    // A staff content hold on one of the posts.
    asOwner(`insert into private.frontend_content_holds(id,post_id,account_id,reason,applied_at)
      values(gen_random_uuid(),'${paidPost}','${payer.id}','A synthetic open staff hold',now());`);
    assert.equal(retry(payer).blocked_reason, "content_hold");
    asOwner(`update private.frontend_content_holds set released_at=now(),release_reason='Checked and fine',
      released_by='${admin.id}' where post_id='${paidPost}' and released_at is null;`);
    // An open report about one of the posts.
    asOwner(`insert into private.reports(post_id,subject_account_id,category,description,reporter_ip_hmac)
      values('${paidPost}','${payer.id}','scam','A synthetic report about this post.',repeat('a',43));`);
    assert.equal(retry(payer).blocked_reason, "report_open");
    asOwner(`update private.reports set status='dismissed',resolved_at=now(),resolved_by='${admin.id}',
      resolution_note='Nothing wrong' where subject_account_id='${payer.id}';`);
    // An invoice still to be paid: staff void it.
    assert.equal(retry(payer).blocked_reason, "invoice_unpaid");
    json(
      staff(
        admin,
        `select api.void_staff_invoice('${unpaidInvoice.invoice_id}','The account was closed');`
      )
    );
    assert.equal(retry(payer).erased_by, "sweep");
  });

  await check(
    "the erasure deletes the content and keeps the payment records with no person",
    () => {
      const erasure = erasureOf(payer);
      assert.ok(erasure.erased_at);
      // The edit copy goes with its post (counted once or twice, by delete order).
      assert.ok(erasure.erased_counts.posts >= 2, JSON.stringify(erasure.erased_counts));
      assert.equal(erasure.erased_counts.enquiries, 1);
      assert.equal(erasure.erased_counts.sponsored_places, 1);
      assert.ok(editCopy, "an edit copy existed");
      assert.equal(
        count(
          `private.posts where edit_of='${paidPost}' or id in ('${paidPost}','${businessPost}')`
        ),
        0
      );
      assert.equal(count(`private.posts where owner_id='${payer.id}'`), 0);
      assert.equal(count(`private.enquiries where id='${sentEnquiry}'`), 0);
      for (const sql of [
        `private.notifications where account_id='${payer.id}'`,
        `private.profiles where account_id='${payer.id}'`,
        `private.verification_localities where owner_id='${payer.id}'`,
        `private.outbox_events where owner_id='${payer.id}'`,
        `private.event_submissions where owner_id='${payer.id}'`,
        `private.frontend_business_checks where owner_id='${payer.id}'`,
        `private.organisation_admins where account_id='${payer.id}'`,
        `private.organisation_sponsorships where owner_id='${payer.id}'`,
        `private.organisation_affiliations where post_id='${businessPost}'`,
      ])
        assert.equal(count(sql), 0, sql);
      assert.equal(
        count("private.organisations where slug='erase-org'"),
        1,
        "the organisation stays"
      );
      assert.equal(
        q(`select state from private.media_objects where id='${paidPhoto}';`),
        "cleanup_required"
      );
      // Kept, unlinked.
      assert.equal(
        count(`private.payments where id='${order}' and owner_id is null and status='complete'`),
        1
      );
      assert.equal(count(`private.payment_lines where payment_id='${order}'`), 1);
      assert.equal(
        count(
          `private.entitlements where payment_id='${order}' and owner_id is null and status='revoked'`
        ),
        1
      );
      assert.equal(
        count(
          `private.partner_commissions where payment_id='${order}' and referred_account_id is null and status='pending'`
        ),
        1
      );
      assert.equal(
        count(
          `private.customer_invoices where id in ('${paidInvoice.invoice_id}','${unpaidInvoice.invoice_id}') and account_id is null`
        ),
        2
      );
      assert.equal(
        count("private.slot_packages where owner_id is null and slot_count=5"),
        1,
        "the package is kept, unlinked"
      );
      assert.equal(
        count(
          `private.individual_slot_limits where identity_hmac='${fingerprintOf("erase-payer")}' and account_id is null`
        ),
        1
      );
      assert.equal(
        count(
          `private.invoice_transfers where id='${transfer.transfer_id}' and account_id is null`
        ),
        1
      );
      for (const [table, column] of [
        ["payments", "owner_id"],
        ["entitlements", "owner_id"],
        ["post_activations", "owner_id"],
        ["partner_commissions", "referred_account_id"],
        ["customer_invoices", "account_id"],
        ["invoice_transfers", "account_id"],
        ["payment_refund_requests", "account_id"],
        ["individual_slot_limits", "account_id"],
        ["slot_packages", "owner_id"],
      ])
        assert.equal(count(`private.${table} where ${column}='${payer.id}'`), 0, table);
      assert.equal(
        json(staff(admin, "select api.get_staff_payment_list(1);")).items.find(
          (i) => i.id === order
        ).user_id,
        null
      );
    }
  );

  await check("the sign-in is removed; kept verification history keeps an empty Auth row", () => {
    const row = authRow(payer);
    assert.equal(row.email, null);
    assert.equal(row.phone, null);
    assert.deepEqual(row.meta, {});
    assert.equal(row.banned, true);
    assert.equal(row.deleted, true);
    assert.equal(signInLeft(payer), 0);
    assert.equal(erasureOf(payer).auth_removed_at, null, "accepted identity facts still name it");
    assert.equal(count(`private.accepted_identity_facts where owner_id='${payer.id}'`), 1);
  });

  await check("the record guards still refuse every other change to a kept payment record", () => {
    fails(`update private.payments set amount_cents=1 where id='${order}';`, "23514");
    const other = completeSlotOrder({ q, json, member, service }, admin2, P30, 1).id;
    fails(`update private.payments set owner_id=null where id='${other}';`, "23514");
    // An erasure of another account cannot unlink this payment.
    fails(
      `begin;\nselect set_config('vm.erasure','${payer.id}',true);\nupdate private.payments set owner_id=null where id='${other}';\ncommit;`,
      "23514"
    );
    // The erasure of its own account changes nothing else.
    fails(
      `begin;\nselect set_config('vm.erasure','${admin2.id}',true);\nupdate private.payments set owner_id=null,amount_cents=1 where id='${other}';\ncommit;`,
      "23514"
    );
    assert.equal(count(`private.payments where id='${other}' and owner_id='${admin2.id}'`), 1);
  });

  await check("the privacy request is completed only after the erasure", () => {
    const replay = json(fulfil(admin2, payerRequest));
    assert.equal(replay.status, "erased", "a replay returns the recorded state");
    assert.equal(replay.erased_at, erasureOf(payer).erased_at);
    assert.equal(json(complete(admin2, payerRequest)).status, "completed");
    assert.match(fails(fulfil(admin2, payerRequest), "PT409"), /deletion_request_required/);
  });

  // ---------------------------------------------- a partner and the money
  await check("an unpaid commission owed to a partner makes the partner's erasure wait", () => {
    close(partnerPerson);
    assert.equal(
      q(`select status from private.partners where account_id='${partnerPerson.id}';`),
      "suspended",
      "a closed partner earns nothing more"
    );
    assert.equal(
      count(
        `private.partner_events where action='suspended_account_closed' and actor_id='${partnerPerson.id}'`
      ),
      1
    );
    q(`select vmtest.erasure_due('${partnerPerson.id}');`);
    sweep();
    assert.equal(erasureOf(partnerPerson).blocked_reason, "commission_unpaid");
  });

  await check("kept payments stay refundable after the erasure", () => {
    // A chargeback of the erased payer's slot reverses the partner's commission.
    const chargeback = json(
      staff(
        admin,
        `select api.record_staff_payment_refund('${order}','chargeback','billing_error','Bank chargeback received','CB-ERASE-1');`
      )
    );
    // A payment with no account always waits for a second staff member.
    assert.equal(chargeback.status, "awaiting_approval", JSON.stringify(chargeback));
    fails(
      staff(admin, `select api.approve_staff_payment_refund('${chargeback.request_id}');`),
      "42501"
    );
    assert.equal(
      json(staff(admin2, `select api.approve_staff_payment_refund('${chargeback.request_id}');`))
        .status,
      "applied"
    );
    assert.equal(q(`select status from private.payments where id='${order}';`), "chargeback");
    assert.equal(
      q(`select status from private.partner_commissions where payment_id='${order}';`),
      "reversed"
    );
    // A refund over R1,000 waits for a second staff member, who approves it.
    const waiting = json(
      staff(
        admin,
        `select api.record_staff_payment_refund('${invoicePayment}','refunded','s14_cancellation','Cancelled under the policy','EFT-BACK-1');`
      )
    );
    assert.equal(waiting.status, "awaiting_approval", JSON.stringify(waiting));
    assert.equal(
      json(staff(admin2, `select api.approve_staff_payment_refund('${waiting.request_id}');`))
        .status,
      "applied"
    );
    assert.equal(
      q(`select status from private.payments where id='${invoicePayment}';`),
      "refunded"
    );
    // Ozow confirms the expired checkout late: no email is queued for nobody,
    // the money waits for staff, who refund it.
    const settled = providerEvent(late, "complete", "late");
    assert.ok(settled.outcome, JSON.stringify(settled));
    assert.equal(
      count(`private.payments where id='${late}' and owner_id is null and status='complete'`),
      1
    );
    assert.equal(
      providerEvent(late, "complete", "late").outcome !== undefined,
      true,
      "a retried notice is safe"
    );
    const refund = json(
      staff(
        admin,
        `select api.record_staff_payment_refund('${late}','refunded','billing_error','Paid after the account was erased','OZ-LATE-1');`
      )
    );
    assert.equal(refund.status, "awaiting_approval", JSON.stringify(refund));
    assert.equal(
      json(staff(admin2, `select api.approve_staff_payment_refund('${refund.request_id}');`))
        .status,
      "applied"
    );
    // Only payment emails may lose their person: any other one still fails.
    fails(
      `insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values('post_expired',gen_random_uuid(),null,'vmtest:'||gen_random_uuid());`,
      "23502"
    );
    assert.equal(count(`private.outbox_events where owner_id is null`), 0);
    assert.equal(
      count(
        `private.payment_refund_requests where account_id is not null and payment_id in ('${order}','${invoicePayment}','${late}')`
      ),
      0
    );
  });

  await check(
    "the partner is erased once nothing is owed; the partner record keeps an empty Auth row",
    () => {
      assert.ok(retry(partnerPerson).erased_at);
      q(`select vmtest.a_day_later('${partnerPerson.id}');`);
      sweep();
      assert.equal(count(`auth.users where id='${partnerPerson.id}'`), 1, "partners names it");
      assert.equal(authRow(partnerPerson).email, null);
      assert.equal(
        count(`private.partners where account_id='${partnerPerson.id}' and status='suspended'`),
        1
      );
      assert.equal(count(`private.partner_commissions where payment_id='${order}'`), 1);
    }
  );

  // ------------------------------------------- an account nothing names
  let plainRequest;
  await check(
    "an unverified member's account is erased and its Auth user deleted after the media cleanup",
    () => {
      plainRequest = close(plain).request_id;
      q(`select vmtest.erasure_due('${plain.id}');`);
      assert.equal(sweep().erased, 1);
      assert.equal(count(`private.posts where id='${plainPost}'`), 0);
      assert.equal(count(`private.profiles where account_id='${plain.id}'`), 0);
      for (const id of [plainPhoto, avatar])
        assert.equal(
          q(`select state from private.media_objects where id='${id}';`),
          "cleanup_required"
        );
      assert.equal(erasureOf(plain).auth_removed_at, null, "media rows still name it");
      const claimed = json(service("select api.claim_media_cleanup(50);"));
      for (const id of [plainPhoto, avatar, paidPhoto]) {
        const job = claimed.find((c) => c.object_id === id);
        assert.ok(job, id);
        assert.equal(
          q(service(`select api.mark_media_deleted('${id}','${job.claim_token}');`)),
          "t"
        );
      }
      q(`select vmtest.a_day_later('${plain.id}');`);
      const run = sweep();
      assert.equal(run.auth_removed, 1, JSON.stringify(run));
      assert.equal(count(`auth.users where id='${plain.id}'`), 0);
      assert.equal(count(`private.account_closures where user_id='${plain.id}'`), 0);
      assert.equal(count(`private.media_objects where owner_id='${plain.id}'`), 0);
      assert.equal(signInLeft(plain), 0);
      assert.ok(erasureOf(plain).auth_removed_at);
      assert.equal(count(`private.account_erasure_requests where request_id='${plainRequest}'`), 1);
      assert.equal(
        q(
          `select subject_user_id is null from private.privacy_requests where id='${plainRequest}';`
        ),
        "t"
      );
      // The payer's Auth row is still named by kept verification history.
      q(`select vmtest.a_day_later('${payer.id}');`);
      sweep();
      assert.equal(count(`auth.users where id='${payer.id}'`), 1);
    }
  );

  await check(
    "the completed notice reaches the address on the request, which is then minimised",
    () => {
      q(privacy(admin, plainRequest, "verify_identity"));
      q(privacy(admin, plainRequest, "approve"));
      const read = json(staff(admin2, `select api.get_account_erasure('${plainRequest}');`));
      assert.equal(read.status, "removed");
      assert.equal(json(complete(admin, plainRequest)).status, "completed");
      // Every other notice was sent already.
      q(`update private.privacy_notice_jobs set delivered_at=now()
        where not (request_id='${plainRequest}' and kind='completed');`);
      const job = json(service("select api.claim_frontend_privacy_notice();"));
      assert.deepEqual(
        [job.request_id, job.kind, job.recipient],
        [plainRequest, "completed", plainEmail]
      );
      q(
        service(
          `select api.complete_frontend_privacy_notice('${job.id}','${job.claim_token}',true);`
        )
      );
      const run = retention();
      assert.ok(run.privacy_requests.minimised >= 1, JSON.stringify(run.privacy_requests));
      const row = json(
        `select to_jsonb(r) from private.privacy_requests r where id='${plainRequest}';`
      );
      assert.equal(row.requester_email, "removed");
      assert.equal(row.requester_phone, "not_provided");
      assert.ok(row.minimised_at);
      assert.equal(row.status, "completed");
      assert.equal(
        q(service("select api.claim_frontend_privacy_notice();")),
        "",
        "nothing left to send"
      );
    }
  );

  // --------------------------------------------------- rejected and failing
  await check("rejecting a member-closed deletion request stops the erasure", () => {
    const keeper = user("erase-rejected");
    const request = close(keeper).request_id;
    q(privacy(admin, request, "reject", ",'The account is under investigation'"));
    // A legal hold for review, and the rejection recorded on the erasure.
    assert.match(
      q(
        `select reason from private.legal_holds where subject_id='${keeper.id}' and released_at is null;`
      ),
      /^Deletion request rejected; review by \d{4}-\d{2}-\d{2}$/
    );
    assert.ok(erasureOf(keeper).rejected_at);
    q(`select vmtest.erasure_due('${keeper.id}');`);
    sweep();
    let row = erasureOf(keeper);
    assert.deepEqual([row.erased_at, row.blocked_reason], [null, "legal_hold"]);
    // Years pass: the rejected request is minimised but never purged while it
    // explains an erasure that has not run.
    q(`update private.privacy_notice_jobs set delivered_at=now() where request_id='${request}';`);
    retention();
    asOwner(
      `update private.privacy_requests set minimised_at=now()-interval '6 years' where id='${request}';`
    );
    retention();
    assert.equal(count(`private.privacy_requests where id='${request}'`), 1, "not purged");
    // Even with the request record gone and the hold released, nothing erases it.
    asOwner(`delete from private.privacy_requests where id='${request}';
      update private.legal_holds set released_at=now(),released_by='${admin.id}' where subject_id='${keeper.id}';`);
    row = retry(keeper);
    assert.deepEqual([row.erased_at, row.blocked_reason], [null, "request_rejected"]);
    assert.ok(authRow(keeper).banned, "the account stays closed");
  });

  await check("a failing account is recorded with its error and never stops the sweep", () => {
    const faulty = user("erase-faulty");
    const faultyRequest = close(faulty).request_id;
    q(`select vmtest.erasure_due('${faulty.id}');`);
    q(`create function vmtest.refuse() returns trigger language plpgsql as $$
      begin raise exception 'fixture failure' using errcode='P0001'; end$$;
      create trigger vmtest_refuse before delete on private.profiles for each row
        when (old.account_id='${faulty.id}') execute function vmtest.refuse();`);
    const run = retention();
    assert.equal(run.accounts.failed, 1, JSON.stringify(run.accounts));
    assert.ok(run.accounts.stuck >= 1);
    assert.ok(run.inbox && run.commerce, "the rest of the retention job ran");
    let row = erasureOf(faulty);
    assert.deepEqual(
      [row.erased_at, row.blocked_reason, row.blocked_detail],
      [null, "error", "P0001"]
    );
    q(`drop trigger vmtest_refuse on private.profiles;
      create trigger vmtest_refuse before delete on auth.users for each row
        when (old.id='${faulty.id}') execute function vmtest.refuse();`);
    row = retry(faulty);
    assert.ok(row.erased_at, "a failed Auth delete never undoes the erasure");
    assert.deepEqual(
      [row.auth_removed_at, row.blocked_reason, row.blocked_detail],
      [null, "error", "P0001"]
    );
    q("drop trigger vmtest_refuse on auth.users;");
    q(`select vmtest.a_day_later('${faulty.id}');`);
    const after = sweep();
    row = erasureOf(faulty);
    assert.ok(row.auth_removed_at, JSON.stringify(after));
    assert.equal(row.blocked_reason, null);
    assert.equal(count(`auth.users where id='${faulty.id}'`), 0);
    // Rejecting a request whose account was already erased is refused.
    assert.match(
      fails(privacy(admin, faultyRequest, "reject", ",'Changed our mind'"), "PT409"),
      /account_erased/
    );
  });

  // ------------------------------------------------- an emailed request
  await check("a staff-ordered erasure keeps the identity-ban fingerprint", () => {
    const request = emailedRequest(banned);
    q(privacy(admin, request, "verify_identity"));
    assert.equal(
      q(`select subject_user_id from private.privacy_requests where id='${request}';`),
      banned.id
    );
    q(privacy(admin, request, "approve"));
    assert.match(fails(complete(admin2, request), "PT409"), /erasure_required/);
    const ordered = json(fulfil(admin2, request));
    assert.equal(ordered.status, "scheduled");
    assert.equal(ordered.closed_by, "staff");
    assert.equal(
      count(
        `private.privacy_request_events where request_id='${request}' and action='erasure_ordered'`
      ),
      1
    );
    assert.ok(
      truth(`(select due_by from private.privacy_requests where id='${request}')
        =(select erase_after+interval '7 days' from private.account_erasures where user_id='${banned.id}')`),
      "due 7 days after the grace period"
    );
    assert.equal(count(`auth.sessions where user_id='${banned.id}'`), 0);
    q(`select vmtest.erasure_due('${banned.id}');`);
    const erased = json(fulfil(admin2, request));
    assert.equal(erased.status, "erased");
    assert.equal(erasureOf(banned).erased_by, "staff");
    assert.equal(authRow(banned).email, null);
    assert.equal(
      count(`private.banned_identities where identity_hmac='${fingerprintOf("erase-banned")}'`),
      1
    );
    assert.equal(count(`auth.users where id='${banned.id}'`), 1, "the ban's case still names it");
    assert.deepEqual(json(fulfil(admin2, request)), erased, "a replay changes nothing");
    assert.equal(json(complete(admin, request)).status, "completed");
  });

  await check("the runbook's interim command orders an erasure only for a second person", () => {
    const command = /```sql\n *(select internal\.order_account_erasure\([^\n]*\);)\n *```/.exec(
      readFileSync("docs/RUNBOOK.md", "utf8").replace(/\r\n/g, "\n")
    )?.[1];
    assert.ok(command, "the command is in docs/RUNBOOK.md");
    const emailed = user("erase-emailed");
    const request = emailedRequest(emailed, "Delete my account please.");
    q(privacy(admin, request, "verify_identity"));
    q(privacy(admin, request, "approve"));
    const run = (personB) =>
      command
        .replaceAll("<request id>", request)
        .replaceAll("<Person B staff account id>", personB.id);
    assert.match(fails(run(admin), "42501"), /second_person_required/);
    fails(run(emailed), "42501");
    fails(run(moderator), "42501");
    assert.equal(count(`private.account_erasures where user_id='${emailed.id}'`), 0);
    assert.equal(json(run(admin2)).status, "scheduled");
    const state = json(staff(admin, `select api.get_account_erasure('${request}');`));
    assert.equal(state.linked, "staff_ordered");
    assert.equal(count(`auth.sessions where user_id='${emailed.id}'`), 0);
  });

  await check("a replayed sweep changes nothing", () => {
    const before = json(
      `select jsonb_agg(to_jsonb(e) order by user_id) from private.account_erasures e;`
    );
    const run = sweep();
    assert.equal(run.erased + run.failed + run.auth_removed, 0, JSON.stringify(run));
    assert.deepEqual(
      json(`select jsonb_agg(to_jsonb(e) order by user_id) from private.account_erasures e;`),
      before
    );
  });

  await check("the rollback refuses once an account was closed", () => {
    assert.match(fails(ROLLBACK, "55000"), /accounts were closed or erased/);
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the commands", () => {
      for (const [sig, roles] of Object.entries(COMMANDS))
        assert.deepEqual(callers(sig), roles, sig);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Account erasure checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
