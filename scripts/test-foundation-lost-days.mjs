#!/usr/bin/env node
// Behaviour checks for 20261125024039_add_lost_days.sql (launch checklist item
// 75): a staff member previews a member's running paid slots and package, then
// adds 1 to 30 lost days to all of them, with a reason; a slot's queued renewal
// moves with it, a package's slots still end together, and every grant moved
// is recorded.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members and staff are written directly as the database owner (staff
// with a verified authenticator app and an AAL2 session, an accepted ID review
// as a synthetic identity fact); members buy slots and packages through the
// production checkout commands and a synthetic Ozow settlement notice; admins
// act through the production API commands with synthetic sessions. Time is
// moved by shifting a member's own dates back (vmtest.travel). The script
// checks the read-only preflight, a drifted body and a premature rollback,
// applies the update and proves apply -> rollback -> apply, then the behaviour.
//
//   node --import tsx scripts/test-foundation-lost-days.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  assertReadOnlyPreflight,
  executeGrants,
  sqlLiteral,
} from "./lib/foundation-sql-checks.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  buyPackage,
  ozowPurchase,
  ozowSettle,
  P30,
  postReviewHelpers,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261125024039_add_lost_days.sql";
const PREVIEW = "api.get_lost_days_preview(text)";
const ADD = "api.add_lost_days(text,integer,text,uuid)";
const INTERNAL = [
  "internal.get_lost_days_preview(text)",
  "internal.add_lost_days(text,integer,text,uuid)",
];
const EXPORT = "internal.frontend_privacy_export_data(uuid)";
const QUOTE = "internal.slot_package_add_quote(uuid)";
/** The 180-day Multi-listing package term (20261114154823_slot_packages.sql). */
const K180 = { id: "e1d7b6a4-0c95-4f8e-b3a2-6d4c8f2e1b55", cents: 60000 };
const NOT_APPLIED = /^lost days: update not applied; running paid grants: \d+$/;
const APPLIED = /^lost days: already applied; running paid grants: \d+; additions: \d+$/;
const REASON = "Platform down for 3 days in December";
const MINUTE = 60;

const SETUP = { update: UPDATE, label: "lostdays", title: "Lost days" };
await runTwoAdminUpdateCheck(SETUP, async ({ database, check, kit, world, admin, admin2 }) => {
  const { q, json, fails, member, staff, preflight, count } = kit;
  const now = () => Math.floor(Date.now() / 1000);

  // Ready posting (the current posting terms accepted, a ready cover image, the
  // form contact channel; a draft Market listing) and moving a member's own
  // dates back, as if time had passed.
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
        values(pid,p_owner,'listing','market','other_items','Lost days listing '||left(pid::text,8),
          'A synthetic description long enough for every rule.','gp','gp_johannesburg');
      insert into private.listing_details(post_id,price_mode,price_cents) values(pid,'amount',12000);
      insert into private.post_contacts(post_id,post_kind,channels) values(pid,'listing',array['form']);
      insert into private.post_media(post_id,object_id,purpose,position) values(pid,cover,'cover',0);
      return pid;
    end$$;
    create function vmtest.travel(p_owner uuid,p_by interval) returns void language plpgsql as $$
    begin
      perform set_config('session_replication_role','replica',true);
      update private.entitlements set starts_at=starts_at-p_by,ends_at=ends_at-p_by where owner_id=p_owner;
      update private.post_activations set activated_at=activated_at-p_by,released_at=released_at-p_by where owner_id=p_owner;
      update private.posts set visible_until=visible_until-p_by,published_at=published_at-p_by,ended_at=ended_at-p_by,
        deletes_at=deletes_at-p_by where owner_id=p_owner;
      update private.post_search_documents d set visible_until=d.visible_until-p_by,published_at=d.published_at-p_by
        from private.posts p where p.id=d.post_id and p.owner_id=p_owner;
      update private.payments set created_at=created_at-p_by,completed_at=completed_at-p_by,
        status_changed_at=status_changed_at-p_by where owner_id=p_owner and status<>'pending';
      perform set_config('session_replication_role','origin',true);
    end$$;`);

  const moderator = world.staffUser("lostdays-mod", "moderator");
  world.review(moderator, admin2, "lostdays-mod");
  const { row, draft, submitSql, fundedBy, approveSql } = postReviewHelpers(kit);
  const travel = (owner, by) => q(`select vmtest.travel('${owner.id}','${by}'::interval);`);
  const lit = (value) => (value === null ? "null" : sqlLiteral(value));
  const previewSql = (who, email, totpAt = now()) =>
    staff(who, `select api.get_lost_days_preview(${lit(email)});`, totpAt);
  const preview = (email, who = admin) => json(previewSql(who, email)).items;
  const addSql = (who, email, days, { reason = REASON, id = randomUUID(), totpAt = now() } = {}) =>
    staff(
      who,
      `select api.add_lost_days(${lit(email)},${days},${lit(reason)},${id === null ? "null" : `'${id}'`});`,
      totpAt
    );
  const add = (email, days, options) => json(addSql(admin, email, days, options));
  const grant = (id) => json(`select to_jsonb(e) from private.entitlements e where e.id='${id}';`);
  const grantsOf = (person) =>
    json(`select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'starts',e.starts_at,'ends',e.ends_at,
        'slot',e.slot_id,'package',e.package_id,'source',e.source,'status',e.status) order by e.created_at,e.id),'[]')
      from private.entitlements e where e.owner_id='${person.id}';`);
  /** Seconds between two instants (b - a). */
  const gap = (a, b) =>
    Number(q(`select extract(epoch from '${b}'::timestamptz-'${a}'::timestamptz);`));
  const DAY = 86400;
  const additions = (requestId) =>
    json(`select coalesce(jsonb_agg(to_jsonb(r)-'id'-'created_at' order by r.entitlement_id),'[]')
      from private.lost_day_additions r where r.request_id='${requestId}';`);
  const chainEnd = (id) => q(`select internal.slot_chain_paid_end('${id}');`);
  const renewalPayment = (owner, ids) => {
    const quoted = json(
      member(
        owner,
        `select api.start_slot_renewal_checkout(array[${ids.map((id) => `'${id}'`).join(",")}]::uuid[],'${P30.id}',${P30.cents * ids.length},true);`
      )
    );
    assert.equal(ozowSettle(kit, owner, quoted.payment_id).outcome, "completed");
    return quoted.payment_id;
  };
  const live = (owner) => {
    const post = draft(owner);
    q(submitSql(owner, post));
    q(approveSql(moderator, post));
    assert.equal(row(post).status, "live");
    return post;
  };
  const searchEnd = (post) =>
    q(`select visible_until from private.post_search_documents where post_id='${post}';`);

  // ------------------------------------------------------------ before
  await check("before the update: nothing new; the read-only preflight says 'not applied'", () => {
    for (const fn of [PREVIEW, ADD, ...INTERNAL])
      assert.equal(q(`select to_regprocedure('${fn}') is null;`), "t", fn);
    assert.equal(q(`select to_regclass('private.lost_day_additions') is null;`), "t");
    const [summary, ...problems] = preflight();
    assert.deepEqual(problems, []);
    assert.equal(summary[0], "summary");
    assert.match(summary[1], NOT_APPLIED);
    assertReadOnlyPreflight(database, kit.preflightSql);
    // A drifted export or package quote body, and a rollback before the update, are refused.
    assertDriftRefused(kit, { label: "lost days", signatures: [EXPORT, QUOTE], rows: 2 });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "lost days",
    applied: APPLIED,
    notApplied: NOT_APPLIED,
  });

  await check("grants: both commands for signed-in callers only; the record has none", () => {
    const grants = executeGrants(json, [PREVIEW, ADD, ...INTERNAL]);
    for (const fn of [PREVIEW, ADD, ...INTERNAL])
      assert.deepEqual(grants[fn], { anon: false, authenticated: true, service_role: false }, fn);
    for (const fn of [PREVIEW, ADD])
      assert.equal(
        q(`select prosecdef from pg_proc where oid='${fn}'::regprocedure;`),
        "f",
        `${fn} is security invoker`
      );
    assert.equal(
      q(`select relrowsecurity from pg_class where oid='private.lost_day_additions'::regclass;`),
      "t"
    );
    fails(member(world.user("ld-nobody"), "select * from private.lost_day_additions;"), "42501");
  });

  // ------------------------------------------------------------- world
  const thandi = world.verified("ld-thandi", admin2);
  q(`select vmtest.terms('${thandi.id}');`);
  ozowPurchase(kit, thandi, P30, 2);

  await check("the preview lists each running Individual slot; nothing is recorded", () => {
    const items = preview(thandi.email);
    assert.equal(items.length, 2);
    const grants = grantsOf(thandi);
    for (const item of items) {
      assert.equal(item.kind, "individual");
      assert.equal(item.slots, 1);
      assert.equal(item.renewals, 0);
      const mine = grants.find((g) => g.id === item.id);
      assert.ok(mine, "the item is the slot's first grant");
      assert.equal(gap(mine.ends, item.ends_at), 0);
    }
    // A different case of the email finds the same account.
    assert.equal(preview(thandi.email.toUpperCase()).length, 2);
    // A member with nothing running: an empty list.
    assert.deepEqual(preview(world.verified("ld-empty", admin2).email), []);
    assert.equal(count("private.lost_day_additions"), 0);
  });

  let renewed;
  let queued;
  let first;
  let post;
  await check(
    "a running slot and its queued renewal move together; the chain ends N days later",
    () => {
      post = live(thandi);
      const funded = fundedBy(post);
      // 17 days later the renewal window is open: renew the slot holding the post.
      travel(thandi, "17 days");
      renewalPayment(thandi, [funded]);
      queued = grantsOf(thandi).find((g) => g.slot === funded);
      assert.ok(queued, "the renewal is queued after the running period");
      renewed = grant(funded);
      assert.equal(gap(renewed.ends_at, queued.starts), 0);
      const items = preview(thandi.email);
      const slot = items.find((i) => i.id === funded);
      assert.equal(slot.renewals, 1);
      assert.equal(gap(queued.ends, slot.ends_at), 0);
      const endBefore = chainEnd(funded);
      const other = grantsOf(thandi).find((g) => g.id !== funded && g.slot === null);

      const id = randomUUID();
      const done = add(thandi.email, 7, { id });
      assert.equal(done.request_id, id);
      assert.equal(done.days, 7);
      assert.equal(done.repeated, false);
      assert.equal(done.items.length, 2);
      const moved = done.items.find((i) => i.id === funded);
      assert.equal(moved.kind, "individual");
      assert.equal(moved.renewals, 1);
      assert.equal(gap(moved.ends_before, moved.ends_after), 7 * DAY);
      // The running grant ends 7 days later and keeps its start.
      const running = grant(funded);
      assert.equal(gap(renewed.starts_at, running.starts_at), 0);
      assert.equal(gap(renewed.ends_at, running.ends_at), 7 * DAY);
      // The renewal starts and ends 7 days later, still right after it.
      const next = grant(queued.id);
      assert.equal(gap(queued.starts, next.starts_at), 7 * DAY);
      assert.equal(gap(queued.ends, next.ends_at), 7 * DAY);
      assert.equal(gap(running.ends_at, next.starts_at), 0);
      assert.equal(gap(endBefore, chainEnd(funded)), 7 * DAY);
      // The other slot moved too.
      assert.equal(gap(other.ends, grant(other.id).ends_at), 7 * DAY);
      // The post's search end follows the slot's new paid end at once.
      assert.equal(gap(chainEnd(funded), searchEnd(post)), 0);
      // One record row per grant moved, with the staff member and reason.
      const rows = additions(id);
      assert.equal(rows.length, 3);
      for (const r of rows) {
        assert.equal(r.actor_id, admin.id);
        assert.equal(r.days, 7);
        assert.equal(r.reason, REASON);
        assert.equal(gap(r.ends_before, r.ends_after), 7 * DAY);
      }
      const renewalRow = rows.find((r) => r.entitlement_id === queued.id);
      assert.equal(gap(renewalRow.starts_before, renewalRow.starts_after), 7 * DAY);
      const runningRow = rows.find((r) => r.entitlement_id === funded);
      assert.equal(gap(runningRow.starts_before, runningRow.starts_after), 0);
      first = { id, done };
    }
  );

  await check(
    "a repeated request adds nothing; reusing its id for anything else is refused",
    () => {
      const before = grantsOf(thandi);
      const again = add(thandi.email, 7, { id: first.id });
      assert.equal(again.repeated, true);
      assert.deepEqual(again.items, first.done.items);
      assert.deepEqual(grantsOf(thandi), before);
      assert.equal(count(`private.lost_day_additions where request_id='${first.id}'`), 3);
      fails(addSql(admin, thandi.email, 8, { id: first.id }), "PT409", /lost_days_request_reused/);
      fails(
        addSql(admin, thandi.email, 7, { id: first.id, reason: "Another reason entirely" }),
        "PT409",
        /lost_days_request_reused/
      );
      const sipho = world.verified("ld-sipho", admin2);
      ozowPurchase(kit, sipho, P30, 1);
      fails(addSql(admin, sipho.email, 7, { id: first.id }), "PT409", /lost_days_request_reused/);
      assert.deepEqual(grantsOf(thandi), before);
    }
  );

  await check("a renewal paid after the change starts at the new end", () => {
    const sipho = world.user("ld-renewer");
    world.review(sipho, admin2, "ld-renewer");
    ozowPurchase(kit, sipho, P30, 1);
    const [slot] = grantsOf(sipho);
    travel(sipho, "22 days");
    add(sipho.email, 5);
    renewalPayment(sipho, [slot.id]);
    const renewal = grantsOf(sipho).find((g) => g.slot === slot.id);
    assert.equal(gap(grant(slot.id).ends_at, renewal.starts), 0);
  });

  await check("a package: every grant ends N days later, still together", () => {
    q(
      `update private.slot_package_sales set on_sale=true,changed_at=now(),reason='Fixture: switched for the checks';`
    );
    const nomsa = world.verified("ld-nomsa", admin2);
    q(`select vmtest.terms('${nomsa.id}');`);
    // An Individual slot bought before the package, then the package and slots added part-way.
    ozowPurchase(kit, nomsa, P30, 1);
    buyPackage(kit, nomsa, 5);
    const packageId = q(`select id from private.slot_packages where owner_id='${nomsa.id}';`);
    travel(nomsa, "3 days");
    const offer = json(member(nomsa, "select api.get_my_package_add_offer();"));
    const added = json(
      member(
        nomsa,
        `select api.start_package_add_checkout('${packageId}',2,${2 * offer.package.unit_price_cents},true);`
      )
    );
    assert.equal(ozowSettle(kit, nomsa, added.payment_id).outcome, "completed");
    const before = grantsOf(nomsa);
    const packageGrants = before.filter((g) => g.package === packageId);
    assert.equal(packageGrants.length, 2);
    assert.equal(gap(packageGrants[0].ends, packageGrants[1].ends), 0);
    const packagePost = live(nomsa);
    assert.ok(
      packageGrants.some((g) => g.id === fundedBy(packagePost)),
      "the post is in the package"
    );

    const items = preview(nomsa.email);
    assert.deepEqual(items.map((i) => i.kind).sort(), ["individual", "package"]);
    const pkg = items.find((i) => i.kind === "package");
    assert.equal(pkg.id, packageId);
    assert.equal(pkg.slots, 7);
    assert.equal(pkg.renewals, 0);

    const done = add(nomsa.email, 30, { reason: "a".repeat(500) });
    assert.equal(done.items.length, 2);
    for (const g of before) assert.equal(gap(g.ends, grant(g.id).ends_at), 30 * DAY, g.id);
    for (const g of before) assert.equal(gap(g.starts, grant(g.id).starts_at), 0, g.id);
    const after = grantsOf(nomsa).filter((g) => g.package === packageId);
    assert.equal(gap(after[0].ends, after[1].ends), 0);
    assert.equal(gap(after[0].ends, searchEnd(packagePost)), 0);
    assert.equal(
      q(`select count(*) from private.slot_packages where owner_id='${nomsa.id}';`),
      "1"
    );
  });

  // LIM-SQL-package-add-days-left: a 180-day package prices at most 179 days.
  await check("a 180-day package with added days: adding slots counts at most 179 days", () => {
    // Before the update the quote counted every whole day left: 209 here,
    // above the request's bound (179) and the website's offer and queue readers,
    // at more than a full term's price.
    const lindi = world.verified("ld-lindi", admin2);
    // Fixture: R3 000 is above the online payment limit (packages that large
    // are invoiced), so the limit is raised for this one checkout and put back
    // byte for byte.
    const limitSql = q(
      "select pg_get_functiondef('internal.online_payment_max_cents()'::regprocedure);"
    );
    q(`create or replace function internal.online_payment_max_cents() returns bigint
      language sql stable set search_path to 'pg_catalog' as $$ select 1000000::bigint; $$;`);
    const quoted = json(
      member(lindi, `select api.start_package_checkout('${K180.id}',5,${K180.cents * 5},true);`)
    );
    assert.equal(ozowSettle(kit, lindi, quoted.payment_id).fulfillment_status, "fulfilled");
    q(`${limitSql};`);
    assert.equal(q("select internal.online_payment_max_cents();"), "130000");
    const packageId = q(`select id from private.slot_packages where owner_id='${lindi.id}';`);
    add(lindi.email, 30);
    const read = json(member(lindi, "select api.get_my_package_add_offer();")).package;
    assert.equal(read.id, packageId);
    assert.equal(read.days_left, 179);
    assert.ok(Number(read.unit_price_cents) <= K180.cents, read.unit_price_cents);
    assert.equal(Number(read.unit_price_cents), Math.round((K180.cents * 179) / 180));
    const asked = json(
      member(
        lindi,
        `select api.request_package_add_invoice('${packageId}',2,${2 * Number(read.unit_price_cents)},true,'${randomUUID()}');`
      )
    );
    assert.equal(asked.days_left, 179);
    assert.equal(asked.status, "requested");
    const listed = json(
      staff(admin, "select api.get_staff_package_invoice_requests();")
    ).items.find((item) => item.request_id === asked.request_id);
    assert.ok(listed, "the staff queue reads the request");
    assert.ok(listed.days_left_now <= 179, String(listed.days_left_now));
    // The quote itself says the same.
    const quote = (owner) =>
      json(`select to_jsonb(x) from internal.slot_package_add_quote('${owner.id}') x;`);
    assert.equal(quote(lindi).days_left, 179);
    q(
      `update private.slot_package_sales set on_sale=false,changed_at=now(),reason='Fixture: switched back after the checks';`
    );
  });

  // LIM-SQL-lost-days-total: 30 days in all pass, one more is refused.
  await check("at most 30 days in all per slot: two changes of 15 pass, a third is refused", () => {
    const vusi = world.verified("ld-vusi", admin2);
    ozowPurchase(kit, vusi, P30, 1);
    const [slot] = grantsOf(vusi);
    add(vusi.email, 15);
    add(vusi.email, 15);
    const before = grantsOf(vusi);
    assert.equal(gap(slot.ends, before[0].ends), 30 * DAY);
    const refusal = fails(addSql(admin, vusi.email, 1), "PT409", /lost_days_limit/);
    assert.match(refusal, /at most 30 days in all/);
    assert.deepEqual(grantsOf(vusi), before);
    assert.equal(count(`private.lost_day_additions where entitlement_id='${slot.id}'`), 2);
    // Any grant over the limit refuses the whole change: nothing moves.
    ozowPurchase(kit, vusi, P30, 1);
    const both = grantsOf(vusi);
    fails(addSql(admin, vusi.email, 5), "PT409", /lost_days_limit/);
    assert.deepEqual(grantsOf(vusi), both);
  });

  await check("ended, revoked, pending and unpaid grants never move", () => {
    const zola = world.verified("ld-zola", admin2);
    // An ended slot.
    ozowPurchase(kit, zola, P30, 1);
    travel(zola, "31 days");
    const [ended] = grantsOf(zola);
    fails(addSql(admin, zola.email, 5), "PT409", /lost_days_nothing_running/);
    // A running slot beside a revoked one, one waiting for verification, a
    // free credit and a house-slot style staff grant.
    ozowPurchase(kit, zola, P30, 3);
    const running = grantsOf(zola).filter((g) => g.id !== ended.id);
    q(`update private.entitlements set status='revoked',revoked_reason='refunded' where id='${running[1].id}';
      update private.entitlements set status='pending_verification' where id='${running[2].id}';`);
    json(
      staff(
        admin,
        `select api.give_free_credit('${zola.email}',1,10,'Recruited at the market day');`
      )
    );
    q(`insert into private.entitlements(owner_id,source,granted_by,slot_capacity,activations_per_period,max_photos,max_videos,starts_at,ends_at)
       values('${zola.id}','staff_grant','${admin.id}',1,4,10,1,now(),now()+interval '20 days');`);
    const before = grantsOf(zola);
    const items = preview(zola.email);
    assert.deepEqual(
      items.map((i) => i.id),
      [running[0].id]
    );
    add(zola.email, 4);
    for (const g of grantsOf(zola)) {
      const was = before.find((b) => b.id === g.id);
      assert.equal(
        gap(was.ends, g.ends),
        g.id === running[0].id ? 4 * DAY : 0,
        `${g.source} ${g.status}`
      );
    }
  });

  // LIM-SQL-lost-days-days and LIM-SQL-lost-days-reason: 0, 31 and -1 days and
  // reasons outside 5 to 500 characters are refused; 30 days with a
  // 500-character reason (the package check) and 1 day with a 5-character
  // reason (the bounds check) pass.
  await check(
    "refusals: email, days, reason, request id, staff, own account, second factor",
    () => {
      const reason = (sql, state, detail) => {
        const refusal = fails(sql, state);
        assert.ok(refusal.includes(detail), refusal);
      };
      const before = grantsOf(thandi);
      reason(addSql(admin, "nobody@example.invalid", 5), "PT409", "lost_days_member_not_found");
      reason(addSql(admin, null, 5), "PT409", "lost_days_member_not_found");
      reason(previewSql(admin, "nobody@example.invalid"), "PT409", "lost_days_member_not_found");
      // A suspended (banned) member counts as no active account.
      const banned = world.verified("ld-banned", admin2);
      ozowPurchase(kit, banned, P30, 1);
      q(`update auth.users set banned_until=now()+interval '1 day' where id='${banned.id}';`);
      reason(addSql(admin, banned.email, 5), "PT409", "lost_days_member_not_found");
      // Nothing running.
      reason(
        addSql(admin, world.verified("ld-none", admin2).email, 5),
        "PT409",
        "lost_days_nothing_running"
      );
      for (const days of [0, 31, -1, "null"])
        reason(addSql(admin, thandi.email, days), "22023", "lost_days_days_invalid");
      for (const text of [null, "", "abcd", "a".repeat(501), "two\nlines", " padded "])
        reason(
          addSql(admin, thandi.email, 5, { reason: text }),
          "22023",
          "lost_days_reason_required"
        );
      reason(addSql(admin, thandi.email, 5, { id: null }), "22023", "lost_days_request_invalid");
      // The admin's own account (the rule of staff money actions).
      reason(addSql(admin, admin.email, 5), "42501", "staff_same_identity");
      reason(previewSql(admin, admin.email), "42501", "staff_same_identity");
      // An admin without an accepted ID review of their own.
      const unreviewed = world.staffUser("ld-admin-noid", "admin");
      reason(addSql(unreviewed, thandi.email, 5), "42501", "staff_review_required");
      reason(previewSql(unreviewed, thandi.email), "42501", "staff_review_required");
      // Not an admin: a moderator, a member; a visitor.
      reason(addSql(moderator, thandi.email, 5), "42501", "capability not granted");
      reason(previewSql(moderator, thandi.email), "42501", "capability not granted");
      fails(
        member(
          thandi,
          `select api.add_lost_days('${thandi.email}',5,'${REASON}','${randomUUID()}');`
        ),
        "42501"
      );
      fails(
        `set role anon;\nselect api.get_lost_days_preview('${thandi.email}');`,
        "42501",
        /permission denied/
      );
      // A second-factor code older than 15 minutes: refused for adding, still
      // fine for the preview (12 hours), which a 13-hour-old code is not.
      reason(
        addSql(admin, thandi.email, 5, { totpAt: now() - 16 * MINUTE }),
        "42501",
        "recent second-factor verification required"
      );
      assert.equal(json(previewSql(admin, thandi.email, now() - 16 * MINUTE)).items.length, 2);
      reason(
        previewSql(admin, thandi.email, now() - 13 * 60 * MINUTE),
        "42501",
        "staff second-factor verification expired"
      );
      // Nothing moved by any refused call.
      assert.deepEqual(grantsOf(thandi), before);
    }
  );

  await check("bounds: 1 day and a 5-character reason pass", () => {
    const before = grantsOf(thandi).filter((g) => g.status === "active");
    add(thandi.email, 1, { reason: "Down." });
    for (const g of before) {
      const after = grant(g.id);
      if (new Date(g.ends) > new Date()) assert.equal(gap(g.ends, after.ends_at), DAY, g.id);
    }
  });

  await check("the record is append-only", () => {
    fails(
      `update private.lost_day_additions set reason='Changed later' where request_id='${first.id}';`,
      "23514"
    );
    fails(`delete from private.lost_day_additions where request_id='${first.id}';`, "23514");
    fails("truncate private.lost_day_additions;", "23514");
  });

  await check("the member's privacy export lists the days added, never the staff member", () => {
    const exported = json(`select internal.frontend_privacy_export_data('${thandi.id}');`);
    const rows = exported.lost_day_additions;
    assert.equal(
      rows.length,
      count(`private.lost_day_additions r join private.entitlements e
      on e.id=r.entitlement_id where e.owner_id='${thandi.id}'`)
    );
    assert.ok(rows.length >= 3);
    assert.deepEqual(Object.keys(rows[0]).sort(), [
      "created_at",
      "days",
      "ends_after",
      "ends_before",
      "entitlement_id",
      "reason",
      "starts_after",
      "starts_before",
    ]);
    assert.equal(Object.keys(exported).length, 44);
  });

  await check("the preflight counts additions after the update; the rollback refuses", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"]
    );
    assert.match(rows[0][1], APPLIED);
    assert.match(rows[0][1], /additions: [1-9]/);
    assert.match(fails(kit.rollbackSql, "55000"), /days were added/);
  });
});
