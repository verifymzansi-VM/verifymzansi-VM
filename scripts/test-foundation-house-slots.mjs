#!/usr/bin/env node
// Behaviour checks for 20261119082834_house_slots.sql (owner's decisions of
// 19 November 2026): house slots for administrators, granted only by the
// database owner with internal.grant_house_slots.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members and staff are written directly as the database owner (staff
// with a verified authenticator app and an AAL2 session, an accepted ID review
// as a synthetic identity fact); members act through the production API
// commands with synthetic sessions, the moderator through the staff commands.
// The script checks the read-only preflight, a drifted body and a premature
// rollback, applies the update and proves apply -> rollback -> apply, then
// checks: no API role can run the grant; each refusal (not an admin, no
// accepted ID review, no authenticator app, an inactive account, the approver
// the same account or not an admin, a count, term or reason outside the rules,
// more than 4 house slots); a granted slot's shape (an Individual slot: 1 live
// post, 4 going live per 30 days, 10 photos and 1 video, no add-ons, no
// payment); a post in it goes through moderation (its own account cannot
// approve it) and never touches the free first post, payments, commissions,
// refunds or invoices; the paid 4-slot count is unchanged; fair use refuses a
// 5th post going live in 30 days; extending moves the slot's end and the
// search end; the record is append-only; removing the admin role ends the
// slots at once (posts expired and out of search) and the free first post is
// still there afterwards; and the rollback refuses once a slot was granted.
//
//   node --import tsx scripts/test-foundation-house-slots.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  assertReadOnlyPreflight,
  createChecks,
  executeGrants,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  createPaymentWorld,
  functionBodyMd5,
  P30,
  psqlSessions,
  sqlValue,
  twoAdmins,
  updateCheckKit,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261119082834_house_slots.sql";
const GRANT = "internal.grant_house_slots(text,integer,integer,text,text)";
const ADDED = {
  [GRANT]: "236ad7e13692d8dd51759289cf647a61",
  "internal.end_house_slot(uuid,text)": "bbd9eded84273b962814a997daaed2e4",
  "internal.house_slots_on_staff_role_change()": "f100ded1785d690054ba54e150e33bff",
};
const NONE = { anon: false, authenticated: false, service_role: false };
const REASON = "Owner-approved house slot for real offers";
const NOT_APPLIED =
  /^house slots: update not applied; admins: \d+; ready to receive: \d+; staff-granted slots: 0; house slots: none \(table absent\)$/;

const started = Date.now();
const { check, current, passed: checks } = createChecks();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const kit = updateCheckKit(database, UPDATE, current);
  const world = createPaymentWorld(kit);
  const { admin, admin2 } = twoAdmins(world, "house");
  const { q, json, fails, member, staff, service, preflight, fingerprint, count } = kit;
  const bodyMd5 = (signature) => functionBodyMd5(kit, signature);

  // Ready posting: the current posting terms accepted, a ready cover image,
  // the form contact channel; a draft Market listing.
  q(`create function vmtest.terms(p_owner uuid) returns void language sql as $$
      insert into private.posting_terms_acceptances(owner_id,version,document_hash)
        select p_owner,v.version,v.document_hash from private.posting_terms_current c
          join private.posting_terms_versions v using(version) where c.singleton
      on conflict do nothing $$;
    create function vmtest.draft(p_owner uuid) returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); cover uuid:=gen_random_uuid(); begin
      insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,width,height,state)
        values(cover,p_owner,'image','media/'||cover,1024,1024,encode(sha256(convert_to(cover::text,'UTF8')),'hex'),'image/jpeg',800,600,'ready');
      insert into private.posts(id,owner_id,kind,area,category_key,title,description,province_id,city_id)
        values(pid,p_owner,'listing','market','other_items','House slot listing '||left(pid::text,8),
          'A synthetic description long enough for every rule.','gp','gp_johannesburg');
      insert into private.listing_details(post_id,price_mode,price_cents) values(pid,'amount',12000);
      insert into private.post_contacts(post_id,post_kind,channels) values(pid,'listing',array['form']);
      insert into private.post_media(post_id,object_id,purpose,position) values(pid,cover,'cover',0);
      return pid;
    end$$;`);
  const moderator = world.staffUser("house-mod", "moderator");
  world.review(moderator, admin2, "house-mod");
  const ready = (person) => {
    q(`select vmtest.terms('${person.id}');`);
    return person;
  };
  ready(admin);
  ready(admin2);

  const grantSql = (recipient, slots, days, reason, approver) =>
    `select internal.grant_house_slots(${sqlValue(recipient?.email ?? recipient)},${slots ?? "null"},${days ?? "null"},${sqlValue(reason)},${sqlValue(approver?.email ?? approver)});`;
  const grant = (recipient, slots = 1, days = 90, approver = admin2, reason = REASON) =>
    json(grantSql(recipient, slots, days, reason, approver));
  const houseSlots = (person) =>
    json(`select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at, e.id),'[]') from private.entitlements e
      where e.owner_id='${person.id}' and e.source='staff_grant';`);
  const events = (person) =>
    json(`select coalesce(jsonb_agg(to_jsonb(h) order by h.recorded_at, h.action, h.id),'[]')
      from private.house_slot_events h join private.entitlements e on e.id=h.entitlement_id
      where e.owner_id='${person.id}';`);
  const row = (id) =>
    json(`select to_jsonb(p)-'description' from private.posts p where p.id='${id}';`);
  const draft = (owner) => q(`select vmtest.draft('${owner.id}');`);
  const submitSql = (owner, id) =>
    member(owner, `select api.submit_post('${id}',${row(id).revision});`);
  const fundedBy = (id) =>
    q(
      `select coalesce((select entitlement_id::text from private.post_activations where post_id='${id}' and released_at is null),'');`
    );
  const approveSql = (who, id) => {
    const lease = json(staff(who, `select api.claim_queue_item('post','${id}');`));
    return staff(
      who,
      `select api.moderate_post(p_post_id=>'${id}',p_expected_revision=>${row(id).revision},p_decision=>'approve',
        p_reason=>null,p_claim_generation=>'${lease.claim_generation}',p_claim_nonce=>'${lease.claim_nonce}');`
    );
  };
  const freeFirstPost = (person) => ({
    requests: count(`private.intro_trial_requests where owner_id='${person.id}'`),
    identities: count(`private.trial_identities where owner_id='${person.id}'`),
    trials: count(`private.entitlements where owner_id='${person.id}' and source='intro_trial'`),
  });
  const money = (person) => ({
    payments: count(`private.payments where owner_id='${person.id}'`),
    lines: count(
      `private.payment_lines l join private.payments p on p.id=l.payment_id where p.owner_id='${person.id}'`
    ),
    commissions: count(`private.partner_commissions where referred_account_id='${person.id}'`),
    refunds: count(`private.payment_refund_requests where account_id='${person.id}'`),
    invoices: count(`private.customer_invoices where account_id='${person.id}'`),
    transfers: count(`private.invoice_transfers where account_id='${person.id}'`),
  });
  const NO_MONEY = {
    payments: 0,
    lines: 0,
    commissions: 0,
    refunds: 0,
    invoices: 0,
    transfers: 0,
  };

  // ------------------------------------------------------------ before
  await check("before the update: the three functions and the table are absent", () => {
    for (const signature of Object.keys(ADDED))
      assert.equal(bodyMd5(signature), "missing", signature);
    assert.equal(q("select to_regclass('private.house_slot_events') is null;"), "t");
  });
  await check("preflight: read only; reads 'not applied'", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], NOT_APPLIED);
    assert.match(rows[0][1], /; admins: 2; ready to receive: 2;/);
    assertReadOnlyPreflight(database, kit.preflightSql);
  });
  await check("a premature rollback and a drifted body are refused", () => {
    const before = fingerprint();
    assert.match(fails(kit.rollbackSql, "55000"), /rollback precondition/);
    q(`create function internal.end_house_slot(p_entitlement uuid, p_reason text) returns integer
      language sql set search_path to 'pg_catalog' as $$ select 0 $$;`);
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.ok(rows[0][1].startsWith("house slots: unexpected state;"), rows[0][1]);
    assert.ok(
      rows[1][1].startsWith("internal.end_house_slot(uuid,text) is not the update's body"),
      rows[1][1]
    );
    assert.match(fails(kit.step.sql, "55000"), /house slots precondition/);
    q("drop function internal.end_house_slot(uuid,text);");
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "house slots",
    applied:
      /^house slots: already applied; admins: 2; ready to receive: 2; staff-granted slots: 0; house slots: 0 \(events: 0\)$/,
    notApplied: NOT_APPLIED,
  });

  await check("only the database owner can run the grant; the helpers are internal", () => {
    const grants = executeGrants(json, Object.keys(ADDED));
    for (const [signature, md5] of Object.entries(ADDED)) {
      assert.equal(bodyMd5(signature), md5, signature);
      assert.deepEqual(grants[signature], NONE, signature);
    }
    fails(member(admin, grantSql(admin, 1, 90, REASON, admin2)), "42501");
    fails(staff(admin2, grantSql(admin, 1, 90, REASON, admin2)), "42501");
    fails(service(grantSql(admin, 1, 90, REASON, admin2)), "42501");
    fails(
      service("select internal.end_house_slot(gen_random_uuid(),'Admin role removed');"),
      "42501"
    );
    // Browsers and the server have no access to the record.
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        q(
          `select has_table_privilege('${role}','private.house_slot_events','select,insert,update,delete');`
        ),
        "f",
        role
      );
    assert.equal(
      q("select relrowsecurity from pg_class where oid='private.house_slot_events'::regclass;"),
      "t"
    );
  });

  await check("refused: not an admin, no ID review, no authenticator app, inactive", () => {
    const plain = ready(world.verified("house-member", admin2));
    fails(grantSql(plain, 1, 90, REASON, admin2), "42501", /house_slots_not_admin/);
    fails(grantSql(moderator, 1, 90, REASON, admin2), "42501", /house_slots_not_admin/);
    const noId = world.staffUser("house-noid", "admin");
    fails(grantSql(noId, 1, 90, REASON, admin2), "42501", /house_slots_identity_required/);
    const noMfa = world.staffUser("house-nomfa", "admin");
    world.review(noMfa, admin2, "house-nomfa");
    q(`delete from auth.mfa_factors where user_id='${noMfa.id}';`);
    fails(grantSql(noMfa, 1, 90, REASON, admin2), "42501", /house_slots_mfa_required/);
    const banned = world.staffUser("house-banned", "admin");
    world.review(banned, admin2, "house-banned");
    q(`update auth.users set banned_until=now()+interval '1 day' where id='${banned.id}';`);
    fails(grantSql(banned, 1, 90, REASON, admin2), "42501", /house_slots_recipient_inactive/);
    const unconfirmed = world.staffUser("house-unconfirmed", "admin");
    q(`update auth.users set email_confirmed_at=null where id='${unconfirmed.id}';`);
    fails(grantSql(unconfirmed, 1, 90, REASON, admin2), "42501", /house_slots_recipient_invalid/);
    fails(
      grantSql("nobody@example.invalid", 1, 90, REASON, admin2),
      "42501",
      /house_slots_recipient_invalid/
    );
    // The same accounts with a valid recipient: the approver is checked too.
    fails(grantSql(admin, 1, 90, REASON, noMfa), "42501", /house_slots_approver_invalid/);
    fails(grantSql(admin, 1, 90, REASON, banned), "42501", /house_slots_approver_invalid/);
    fails(grantSql(admin, 1, 90, REASON, unconfirmed), "42501", /house_slots_approver_invalid/);
    for (const extra of [noId, noMfa, banned, unconfirmed])
      q(
        `update private.staff_roles set revoked_at=now(),revoked_by='${admin2.id}' where user_id='${extra.id}';`
      );
  });
  await check("refused: self-approval, an approver who is not an admin", () => {
    fails(grantSql(admin, 1, 90, REASON, admin), "42501", /house_slots_self_approval/);
    fails(
      grantSql(admin, 1, 90, REASON, admin.email.toUpperCase()),
      "42501",
      /house_slots_self_approval/
    );
    fails(grantSql(admin, 1, 90, REASON, moderator), "42501", /house_slots_approver_invalid/);
    fails(grantSql(admin, 1, 90, REASON, null), "42501", /house_slots_approver_invalid/);
  });
  await check("refused: no written reason, a count or term outside the rules", () => {
    for (const reason of [null, "", "ok", " padded reason ", "x".repeat(501)])
      fails(grantSql(admin, 1, 90, reason, admin2), "22023", /house_slots_reason_required/);
    for (const slots of [null, 0, 5, -1])
      fails(grantSql(admin, slots, 90, REASON, admin2), "22023", /house_slots_count_invalid/);
    for (const days of [null, 6, 181])
      fails(grantSql(admin, 1, days, REASON, admin2), "22023", /house_slots_term_invalid/);
    assert.deepEqual(houseSlots(admin), []);
    assert.equal(count("private.house_slot_events"), 0);
  });

  let slot;
  await check("a grant succeeds for an eligible admin: an Individual slot's shape", () => {
    const done = grant(admin, 1, 90);
    assert.deepEqual(
      [done.account_id, done.approved_by, done.added, done.extended, done.house_slots],
      [admin.id, admin2.id, 1, 0, 1]
    );
    const [e] = houseSlots(admin);
    slot = e.id;
    assert.deepEqual(
      {
        source: e.source,
        area: e.area,
        status: e.status,
        granted_by: e.granted_by,
        payment_id: e.payment_id,
        payment_line_id: e.payment_line_id,
        package_id: e.package_id,
        slot_capacity: e.slot_capacity,
        activations_per_period: e.activations_per_period,
        activation_period_days: e.activation_period_days,
        max_photos: e.max_photos,
        max_videos: e.max_videos,
        addon_capabilities: e.addon_capabilities,
      },
      {
        source: "staff_grant",
        area: null,
        status: "active",
        granted_by: admin2.id,
        payment_id: null,
        payment_line_id: null,
        package_id: null,
        slot_capacity: 1,
        activations_per_period: 4,
        activation_period_days: 30,
        max_photos: 10,
        max_videos: 1,
        addon_capabilities: [],
      }
    );
    assert.equal(
      q(
        `select ends_at-starts_at='90 days'::interval from private.entitlements where id='${slot}';`
      ),
      "t"
    );
    const recorded = events(admin);
    assert.equal(recorded.length, 1);
    assert.deepEqual(
      [recorded[0].action, recorded[0].approved_by, recorded[0].reason, recorded[0].entitlement_id],
      ["granted", admin2.id, REASON, slot]
    );
    // The member's own dashboard lists it, with no checkout or renewal.
    const mine = json(member(admin, "select api.get_my_slots_v2();"));
    const listed = mine.slots.find((s) => s.id === slot);
    assert.deepEqual(
      [listed.source, listed.individual, listed.renewable, listed.places],
      ["staff_grant", false, false, 1]
    );
    // Not one of the 4 paid Individual slots.
    assert.deepEqual([mine.individual.held, mine.individual.pending], [0, 0]);
    assert.match(preflight()[0][1], /; staff-granted slots: 1; house slots: 1 \(events: 1\)$/);
  });

  let first;
  await check(
    "a house-slot post goes through moderation; its own account cannot approve it",
    () => {
      first = draft(admin);
      const submitted = json(submitSql(admin, first));
      assert.equal(submitted.status, "pending_moderation");
      assert.equal(fundedBy(first), slot);
      assert.equal(row(first).status, "pending_moderation");
      // The admin cannot approve their own post.
      fails(
        staff(admin, `select api.claim_queue_item('post','${first}');`),
        "42501",
        /self-review is not allowed/
      );
      const own = kit.run(
        staff(
          admin,
          `select api.moderate_post(p_post_id=>'${first}',p_expected_revision=>${row(first).revision},p_decision=>'approve',
          p_reason=>null,p_claim_generation=>'1',p_claim_nonce=>'${randomUUID()}');`
        )
      );
      assert.notEqual(own.status, 0, "an admin approved their own post");
      assert.equal(row(first).status, "pending_moderation");
      q(approveSql(moderator, first));
      assert.equal(row(first).status, "live");
      assert.equal(
        q(`select is_visible from private.post_search_documents where post_id='${first}';`),
        "t"
      );
    }
  );
  await check("the free first post is untouched; no payment, commission, refund or invoice", () => {
    assert.deepEqual(freeFirstPost(admin), { requests: 0, identities: 0, trials: 0 });
    assert.deepEqual(money(admin), NO_MONEY);
    assert.equal(count("private.payments"), 0);
    assert.equal(count("private.partner_commissions"), 0);
    assert.equal(count("private.payment_refund_requests"), 0);
    assert.equal(count("private.customer_invoices"), 0);
    assert.equal(count("private.invoices"), 0);
    // A slot's single place is in use: a second post waits for capacity and
    // never falls back to the free first post.
    const second = draft(admin);
    fails(submitSql(admin, second), "PT409", /all posting capacity is in use/);
    assert.equal(row(second).status, "draft");
    assert.deepEqual(freeFirstPost(admin), { requests: 0, identities: 0, trials: 0 });
  });

  let fourth;
  await check("fair use: a 5th post going live in 30 days is refused", () => {
    // Three more posts went live in this slot in the last 30 days and ended.
    q(`set session_replication_role=replica;
      insert into private.post_activations(post_id,entitlement_id,owner_id,activated_at,released_at,release_reason)
        select null,'${slot}','${admin.id}',now()-make_interval(days=>n),now()-make_interval(days=>n)+interval '1 hour','deleted'
        from generate_series(1,3) n;
      set session_replication_role=origin;`);
    // The first post ends (the owner marks it sold): its place is free again.
    q(`set session_replication_role=replica;
      update private.post_activations set released_at=now(),release_reason='sold'
        where post_id='${first}' and released_at is null;
      set session_replication_role=origin;`);
    const next = draft(admin);
    fails(submitSql(admin, next), "PT409", /all posting capacity is in use/);
    assert.equal(row(next).status, "draft");
    assert.deepEqual(freeFirstPost(admin), { requests: 0, identities: 0, trials: 0 });
    // Once one of the four is older than 30 days, the post goes in.
    q(`set session_replication_role=replica;
      update private.post_activations set activated_at=now()-interval '31 days'
        where id=(select id from private.post_activations where entitlement_id='${slot}' and post_id is null
          order by activated_at desc limit 1);
      set session_replication_role=origin;`);
    assert.equal(json(submitSql(admin, next)).status, "pending_moderation");
    assert.equal(fundedBy(next), slot);
    q(approveSql(moderator, next));
    assert.equal(row(next).status, "live");
    fourth = next;
  });

  await check(
    "more than 4 house slots is refused; extending moves the end and the search end",
    () => {
      // Up to 4: three are added, the current one is extended to the new end.
      q(`update private.entitlements set ends_at=now()+interval '10 days' where id='${slot}';`);
      const done = grant(admin, 4, 120);
      assert.deepEqual([done.added, done.extended, done.slots.length], [3, 1, 4]);
      const slots = houseSlots(admin);
      assert.equal(slots.length, 4);
      assert.equal(
        q(
          `select count(distinct ends_at) from private.entitlements where owner_id='${admin.id}' and source='staff_grant';`
        ),
        "1"
      );
      assert.equal(
        q(
          `select abs(extract(epoch from ends_at-(now()+interval '120 days')))<60 from private.entitlements where id='${slot}';`
        ),
        "t"
      );
      // The live post's search end follows the slot.
      assert.equal(
        q(`select s.visible_until=e.ends_at from private.post_search_documents s, private.entitlements e
         where s.post_id='${fourth}' and e.id='${slot}';`),
        "t"
      );
      assert.deepEqual(
        events(admin)
          .map((e) => e.action)
          .sort(),
        ["extended", "granted", "granted", "granted", "granted"]
      );
      fails(grantSql(admin, 5, 90, REASON, admin2), "22023", /house_slots_count_invalid/);
      fails(grantSql(admin, 3, 90, REASON, admin2), "22023", /already holds 4 house slots/);
      // Running it again never shortens a slot.
      const again = grant(admin, 4, 30);
      assert.deepEqual([again.added, again.extended], [0, 0]);
      assert.equal(houseSlots(admin).length, 4);
      assert.equal(events(admin).length, 5);
    }
  );
  await check("the record is append-only", () => {
    const id = events(admin)[0].id;
    fails(
      `update private.house_slot_events set reason='Changed afterwards' where id='${id}';`,
      "23514",
      /append-only/
    );
    fails(`delete from private.house_slot_events where id='${id}';`, "23514", /append-only/);
    fails("truncate private.house_slot_events;", "23514", /append-only/);
    fails(
      `insert into private.house_slot_events(entitlement_id,action,ends_at,approved_by,reason)
        values('${slot}','granted',now(),null,'${REASON}');`,
      "23514",
      /house_slot_events_approver_check/
    );
  });

  await check("removing the admin role ends the house slots at once", () => {
    // Another staff member's role change leaves them alone.
    q(
      `update private.staff_roles set revoked_at=now(),revoked_by='${admin2.id}' where user_id='${moderator.id}';`
    );
    assert.equal(houseSlots(admin).filter((e) => e.status === "active").length, 4);
    q(
      `update private.staff_roles set revoked_at=now(),revoked_by='${admin2.id}' where user_id='${admin.id}' and revoked_at is null;`
    );
    const slots = houseSlots(admin);
    assert.deepEqual(
      slots.map((e) => [e.status, e.revoked_reason]),
      Array(4).fill(["revoked", "house_slot_ended"])
    );
    const post = row(fourth);
    assert.deepEqual([post.status, post.status_reason], ["expired", "Slot ended"]);
    assert.equal(fundedBy(fourth), "");
    assert.equal(
      q(`select is_visible from private.post_search_documents where post_id='${fourth}';`),
      "f"
    );
    const ended = events(admin).filter((e) => e.action === "ended");
    assert.equal(ended.length, 4);
    assert.ok(ended.every((e) => e.approved_by === null && e.reason === "Admin role removed"));
    fails(grantSql(admin, 1, 90, REASON, admin2), "42501", /house_slots_not_admin/);
    assert.deepEqual(money(admin), NO_MONEY);
  });
  await check("after the house slots end, the free first post is still there", () => {
    const next = draft(admin);
    assert.equal(json(submitSql(admin, next)).status, "pending_moderation");
    assert.equal(fundedBy(next), "");
    assert.deepEqual(freeFirstPost(admin), { requests: 1, identities: 0, trials: 0 });
  });
  await check("a role change from admin ends them too; a deleted role row as well", () => {
    const admin3 = ready(world.staffUser("house-admin3", "admin"));
    world.review(admin3, admin2, "house-admin3");
    assert.equal(grant(admin3, 2, 90).added, 2);
    q(
      `update private.staff_roles set role='governor' where user_id='${admin3.id}' and revoked_at is null;`
    );
    assert.ok(houseSlots(admin3).every((e) => e.status === "revoked"));
    const admin4 = ready(world.staffUser("house-admin4", "admin"));
    world.review(admin4, admin2, "house-admin4");
    assert.equal(grant(admin4, 1, 90).added, 1);
    q(`delete from private.staff_roles where user_id='${admin4.id}';`);
    assert.ok(houseSlots(admin4).every((e) => e.status === "revoked"));
  });
  await check("a role removal racing a grant: the grant's slots end", async () => {
    const admin5 = ready(world.staffUser("house-admin5", "admin"));
    world.review(admin5, admin2, "house-admin5");
    const { session, sessionAfter } = psqlSessions(database);
    const [granted, removed] = await Promise.all([
      session(`begin;\n${grantSql(admin5, 2, 90, REASON, admin2)}\nselect pg_sleep(2);\ncommit;`),
      sessionAfter(
        700,
        `update private.staff_roles set revoked_at=now(),revoked_by='${admin2.id}' where user_id='${admin5.id}' and revoked_at is null;`
      ),
    ]);
    assert.equal(granted.status, 0, granted.stderr);
    assert.equal(removed.status, 0, removed.stderr);
    const slots = houseSlots(admin5);
    assert.equal(slots.length, 2);
    assert.ok(slots.every((e) => e.status === "revoked"));
  });
  await check("the preflight counts; the rollback refuses once a slot was granted", () => {
    assert.match(
      preflight()[0][1],
      /^house slots: already applied; admins: \d+; ready to receive: \d+; staff-granted slots: 0; house slots: 0 \(events: \d+\)$/
    );
    const before = fingerprint();
    assert.match(fails(kit.rollbackSql, "55000"), /house slot events are recorded/);
    assert.equal(fingerprint(), before);
  });

  await check(
    "the paid 4-slot limit is unchanged: the admin can still order 4 Individual slots",
    () => {
      // Asked for after the checks above, so no payment existed before.
      const quoted = json(
        member(admin2, `select api.start_slot_checkout('${P30.id}',4,${P30.cents * 4},true);`)
      );
      assert.ok(quoted.payment_id);
      // admin2 holds no house slots; the admin who held 4 orders 4 paid slots too.
      q(
        `insert into private.staff_roles(user_id,role,granted_by) values('${admin.id}','admin','${admin2.id}');`
      );
      assert.equal(grant(admin, 4, 90).added, 4);
      const own = json(
        member(admin, `select api.start_slot_checkout('${P30.id}',4,${P30.cents * 4},true);`)
      );
      assert.ok(own.payment_id);
      assert.equal(houseSlots(admin).filter((e) => e.status === "active").length, 4);
    }
  );

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the house slots", () => {
      for (const [signature, md5] of Object.entries(ADDED))
        assert.equal(bodyMd5(signature), md5, signature);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `House slots checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
