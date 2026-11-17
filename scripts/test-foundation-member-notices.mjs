#!/usr/bin/env node
// Behaviour checks for 20261117140533_member_notices_in_app.sql: every email
// kind that added no notice of its own (an accepted ID check, a confirmed
// mobile number, payments, the introductory allowance, the post lifecycle
// notices and the slot renewal reminder) now also adds a notice of the same
// kind for the member, once per queued email; each post moderation decision
// tells the post's owner; the enquiry-inbox reads keep to their own kinds.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. The script runs the update's read-only preflight, checks its refusals,
// applies it, proves apply -> rollback -> apply returns the same fingerprints,
// then checks the notices through the bell's own read as the member. A mobile
// number is confirmed through the production service commands; the other
// events are queued as the commands that own them queue them. Any later updates
// are applied at the end.
//
//   node --import tsx scripts/test-foundation-member-notices.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { phoneChecks } from "./lib/foundation-phone-checks.mjs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertReadOnlyPreflight,
  openUpdateCheck,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261117140533_member_notices_in_app.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const LIST = "internal.list_my_notifications(timestamp with time zone,uuid,integer)";
const FRONTEND_LIST =
  "internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone)";
const POST_KINDS = [
  "post_expired",
  "post_expiry_reminder",
  "draft_deletion_warning",
  "post_sold",
  "post_kept",
];
const OTHER_KINDS = [
  "identity_accepted",
  "verification_phone_confirmed",
  "payment_completed",
  "payment_reversed",
  "payment_reconciliation_required",
  "trial_started",
  "slot_renewal_reminder",
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
  service,
  fingerprint,
  bodyMd5,
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const count = (sql) => Number(q(`select count(*) from ${sql};`));

  // ------------------------------------------------------- synthetic world
  q(`create schema if not exists vmtest;
    create function vmtest.post(p_owner uuid,p_kind text,p_area text) returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); cat text; begin
      select c.category_key into cat from private.post_category_contracts c
        where c.kind=p_kind and c.area=p_area order by c.category_key limit 1;
      insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
        values(pid,p_owner,p_kind,p_area,cat,(select a.key from private.category_activities a join private.categories c on c.key=a.category_key
          where a.category_key=cat and c.activity_required order by a.key limit 1),
          'Fixture '||p_kind||' '||left(pid::text,8),'A synthetic description long enough for every rule.','gp','gp_johannesburg');
      if p_kind='listing' then insert into private.listing_details(post_id,price_mode,price_cents) values(pid,'amount',12000); end if;
      return pid;
    end$$;`);
  const post = (owner) => q(`select vmtest.post('${owner.id}','listing','market');`);
  /** Queues an email as the command that owns `kind` does. */
  const queue = (kind, owner, subject, key = `${kind}:${subject}`) =>
    q(`insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
        values('${kind}','${subject}','${owner}','${key}') on conflict(dedupe_key) do nothing;`);
  const notices = (owner, kind) =>
    json(`select coalesce(jsonb_agg(jsonb_build_object('subject',subject_id,'post',post_id) order by created_at,id),'[]')
      from private.notifications where account_id='${owner.id}' and kind='${kind}';`);
  const moderate = (staffer, postId, decision, editId = null) =>
    q(`insert into private.moderation_log(post_id,edit_id,staff_id,decision,post_revision,reason)
        values('${postId}',${editId ? `'${editId}'` : "null"},'${staffer.id}','${decision}',1,
          ${decision === "reject" ? "'Photos do not show the item.'" : "null"});`);
  const bell = (owner) =>
    json(member(owner, `select api.list_my_frontend_notices(50,false,null);`));
  const inbox = (owner) => json(member(owner, `select api.list_my_notifications(50);`));
  const staffer = syntheticMember("notice-staff");

  // ------------------------------------------------------------ before
  await check("before the update: an accepted ID check reaches no bell", () => {
    const early = syntheticMember("notice-early");
    queue("identity_accepted", early.id, crypto.randomUUID());
    assert.deepEqual(notices(early, "identity_accepted").length, 0);
    const pid = post(early);
    moderate(staffer, pid, "approve");
    assert.equal(count(`private.notifications where account_id='${early.id}'`), 0);
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
      "member notices in app: update not applied (reviewed bodies; apply only once the website release that knows these kinds is live); new-kind notices: 0"
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    const live = q(`select pg_get_functiondef('${LIST}'::regprocedure);`);
    q(
      `do $$begin execute replace(pg_get_functiondef('${LIST}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[0][1], /unexpected bodies/);
    assert.match(rows[1][1], /list_my_notifications.* is not the reviewed body/);
    assert.match(fails(step.sql, "55000"), /notification list drift/);
    q(`${live};`);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "member notices in app",
    fingerprint,
    preflightRows: preflight,
    appliedSummary: /^member notices in app: already applied; new-kind notices: 0$/,
  });

  const owner = syntheticMember("notice-owner");
  await check("each email kind without a notice of its own now adds one", () => {
    for (const kind of OTHER_KINDS) {
      const subject = crypto.randomUUID();
      queue(kind, owner.id, subject);
      assert.deepEqual(notices(owner, kind), [{ subject, post: null }], kind);
    }
    for (const kind of POST_KINDS) {
      const pid = post(owner);
      queue(kind, owner.id, pid);
      assert.deepEqual(notices(owner, kind), [{ subject: pid, post: pid }], kind);
    }
  });
  await check("a deleted post's notice outlives the post", () => {
    const pid = post(owner);
    q(`begin;
      insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values('post_deleted','${pid}','${owner.id}','post_deleted:${pid}');
      delete from private.posts where id='${pid}';
      commit;`);
    assert.deepEqual(notices(owner, "post_deleted"), [{ subject: pid, post: null }]);
  });
  await check("a repeated email adds no second notice", () => {
    const subject = crypto.randomUUID();
    queue("payment_completed", owner.id, subject, `payment_completed:${subject}`);
    queue("payment_completed", owner.id, subject, `payment_completed:${subject}`);
    assert.equal(
      count(`private.notifications where account_id='${owner.id}' and subject_id='${subject}'`),
      1
    );
  });
  await check("kinds that notify on their own are not doubled", () => {
    const other = syntheticMember("notice-own-kinds");
    for (const kind of [
      "enquiry_received",
      "account_warning",
      "business_check_update",
      "verification_returned",
    ])
      queue(kind, other.id, crypto.randomUUID());
    assert.equal(count(`private.notifications where account_id='${other.id}'`), 0);
  });
  await check("an email without an account still queues and adds no notice", () => {
    const ghost = crypto.randomUUID();
    queue("identity_accepted", ghost, crypto.randomUUID());
    assert.equal(count(`private.outbox_events where owner_id='${ghost}'`), 1);
    assert.equal(count(`private.notifications where account_id='${ghost}'`), 0);
  });
  await check("confirming a mobile number through the service commands adds a notice", () => {
    const { prove } = phoneChecks({ q, json, fails, service });
    const caller = syntheticMember("notice-phone");
    prove(caller, "+27710000071");
    assert.equal(notices(caller, "verification_phone_confirmed").length, 1);
  });
  await check("each moderation decision tells the post's owner", () => {
    const author = syntheticMember("notice-author");
    const fresh = post(author);
    const refused = post(author);
    const live = post(author);
    const edit = crypto.randomUUID();
    const badEdit = crypto.randomUUID();
    moderate(staffer, fresh, "approve");
    moderate(staffer, refused, "reject");
    moderate(staffer, live, "approve", edit);
    moderate(staffer, live, "reject", badEdit);
    assert.deepEqual(notices(author, "post_approved"), [{ subject: fresh, post: fresh }]);
    assert.deepEqual(notices(author, "post_rejected"), [{ subject: refused, post: refused }]);
    assert.deepEqual(notices(author, "post_changes_approved"), [{ subject: edit, post: live }]);
    assert.deepEqual(notices(author, "post_changes_rejected"), [{ subject: badEdit, post: live }]);
    assert.equal(count(`private.notifications where account_id='${staffer.id}'`), 0);
  });
  await check("the bell lists the new notices; the enquiry inbox does not", () => {
    const page = bell(owner);
    const kinds = new Set(page.items.map((n) => n.kind));
    for (const kind of [...OTHER_KINDS, ...POST_KINDS, "post_deleted"])
      assert.ok(kinds.has(kind), kind);
    assert.equal(page.unread_count, page.items.length);
    const enquiries = inbox(owner);
    assert.deepEqual(enquiries.items, []);
    assert.equal(enquiries.next_cursor, null);
    assert.equal(bodyMd5(FRONTEND_LIST), "e397d8e39f9939146339f5b1b368a51c");
  });
  await check("the preflight counts the new notices", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^member notices in app: already applied; new-kind notices: [1-9]\d*$/
    );
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep adding the notices", () => {
      const keeper = syntheticMember("notice-keeper");
      queue("identity_accepted", keeper.id, crypto.randomUUID());
      assert.equal(notices(keeper, "identity_accepted").length, 1);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Member notice checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
