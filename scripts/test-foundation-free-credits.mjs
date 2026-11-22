#!/usr/bin/env node
// Behaviour checks for 20261122130744_free_credits.sql (launch checklist item
// 70, owner's design of 22 November 2026): an admin gives an ID-verified
// member free posts (1 to 6 posts for 1 to 30 days, with a reason) and extends
// a gift by 1 to 30 days at a time; every gift and extension is recorded.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members and staff are written directly as the database owner (staff
// with a verified authenticator app and an AAL2 session, an accepted ID review
// as a synthetic identity fact); admins act through the production API
// commands with synthetic sessions, members through the posting commands, a
// moderator through the staff queue. The script checks the read-only
// preflight, a drifted body and a premature rollback, applies the update and
// proves apply -> rollback -> apply, then the behaviour.
//
//   node --import tsx scripts/test-foundation-free-credits.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import {
  assertReadOnlyPreflight,
  executeGrants,
  sqlLiteral,
} from "./lib/foundation-sql-checks.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261122130744_free_credits.sql";
const GIVE = "api.give_free_credit(text,integer,integer,text)";
const EXTEND = "api.extend_free_credit(uuid,integer,text)";
const LIST = "api.list_free_credits()";
const INTERNAL = [
  "internal.give_free_credit(text,integer,integer,text)",
  "internal.extend_free_credit(uuid,integer,text)",
  "internal.list_free_credits()",
];
const NOT_APPLIED = /^free credits: update not applied; entitlements: \d+$/;
const APPLIED =
  /^free credits: already applied; entitlements: \d+; gifts: \d+ \(active: \d+\); events: \d+$/;
const REASON = "Recruited at the Richards Bay market day";
const MINUTE = 60;

const SETUP = { update: UPDATE, label: "freecredit", title: "Free credits" };
await runTwoAdminUpdateCheck(SETUP, async ({ database, check, kit, world, admin, admin2 }) => {
  const { q, json, fails, member, staff, preflight, count } = kit;
  const now = () => Math.floor(Date.now() / 1000);

  // The world's stand-in for internal.current_verified_identity, with aliases:
  // an alias gives an account another account's identity, which the real
  // schema never allows, to check the same-person refusal.
  q(`create table vmtest.identity_alias(owner_id uuid primary key, identity_hmac text not null);
    create or replace function internal.current_verified_identity(p_owner uuid) returns text
      language sql set search_path to 'pg_catalog' as $fn$
      select coalesce((select x.identity_hmac from vmtest.identity_alias x where x.owner_id=p_owner),
          (select f.identity_hmac from private.accepted_identity_facts f where f.owner_id=p_owner and f.revoked_at is null))
        where exists(select 1 from private.current_account_access a where a.id=p_owner) $fn$;`);
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
        values(pid,p_owner,'listing','market','other_items','Free credit listing '||left(pid::text,8),
          'A synthetic description long enough for every rule.','gp','gp_johannesburg');
      insert into private.listing_details(post_id,price_mode,price_cents) values(pid,'amount',12000);
      insert into private.post_contacts(post_id,post_kind,channels) values(pid,'listing',array['form']);
      insert into private.post_media(post_id,object_id,purpose,position) values(pid,cover,'cover',0);
      return pid;
    end$$;`);

  const moderator = world.staffUser("freecredit-mod", "moderator");
  world.review(moderator, admin2, "freecredit-mod");
  const giveSql = (who, email, posts, days, reason = REASON, totpAt = now()) =>
    staff(
      who,
      `select api.give_free_credit(${email === null ? "null" : sqlLiteral(email)},${posts},${days},${
        reason === null ? "null" : sqlLiteral(reason)
      });`,
      totpAt
    );
  const give = (email, posts = 1, days = 30, who = admin) => json(giveSql(who, email, posts, days));
  const extendSql = (who, id, days, reason = REASON, totpAt = now()) =>
    staff(
      who,
      `select api.extend_free_credit('${id}',${days},${reason === null ? "null" : sqlLiteral(reason)});`,
      totpAt
    );
  const extend = (id, days = 30) => json(extendSql(admin, id, days));
  const list = (who = admin, totpAt = now()) =>
    json(staff(who, `select api.list_free_credits();`, totpAt)).items;
  const gift = (id) => json(`select to_jsonb(e) from private.entitlements e where e.id='${id}';`);
  const events = (id) =>
    json(`select coalesce(jsonb_agg(to_jsonb(f)-'id'-'created_at' order by f.created_at, f.action),'[]')
      from private.free_credit_events f where f.entitlement_id='${id}';`);
  const near = (instant, expected) =>
    q(`select abs(extract(epoch from '${instant}'::timestamptz-(${expected})))<60;`);
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
  // The sales figures without their clock fields.
  const sales = () => {
    const summary = json(staff(admin, "select api.get_staff_sales_summary();"));
    const strip = (value) =>
      Object.fromEntries(Object.entries(value).filter(([key]) => !key.endsWith("_at")));
    return { vat: strip(summary.vat), products: summary.products, checkouts: summary.checkouts };
  };

  // ------------------------------------------------------------ before
  await check("before the update: preflight read only, 'not applied'", () => {
    assert.equal(q(`select to_regprocedure('${GIVE}') is null;`), "t");
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], NOT_APPLIED);
    assertReadOnlyPreflight(database, kit.preflightSql);
  });
  await check("a drifted body and a premature rollback are refused", () => {
    assertDriftRefused(kit, {
      label: "free credits",
      signatures: ["internal.get_my_frontend_post_manager()"],
      rows: 2,
    });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "free credits",
    applied: APPLIED,
    notApplied: NOT_APPLIED,
  });

  await check("grants: the three commands for signed-in callers only; the record has none", () => {
    const grants = executeGrants(json, [GIVE, EXTEND, LIST, ...INTERNAL]);
    for (const fn of [GIVE, EXTEND, LIST, ...INTERNAL])
      assert.deepEqual(grants[fn], { anon: false, authenticated: true, service_role: false }, fn);
    for (const fn of [GIVE, EXTEND, LIST])
      assert.equal(
        q(`select prosecdef from pg_proc where oid='${fn}'::regprocedure;`),
        "f",
        `${fn} is security invoker`
      );
    assert.equal(
      q(`select relrowsecurity from pg_class where oid='private.free_credit_events'::regclass;`),
      "t"
    );
    fails(member(world.user("fc-nobody"), "select * from private.free_credit_events;"), "42501");
    assert.equal(
      q(`select string_agg(capability||':'||requires_recent_mfa,' ' order by capability)
        from private.staff_capabilities where capability like 'free_credit:%' and role='admin';`),
      "free_credit:give:true free_credit:view:false"
    );
    assert.equal(
      q(
        `select count(*) from private.staff_capabilities where capability like 'free_credit:%' and role<>'admin';`
      ),
      "0"
    );
  });

  // ------------------------------------------------------------- world
  const salesBefore = sales();
  const thandi = world.verified("fc-thandi", admin);
  q(`select vmtest.terms('${thandi.id}');`);
  let first;

  await check("a gift: an entitlement of 1 post for 30 days, recorded", () => {
    const given = give(` ${thandi.email.toUpperCase()} `);
    first = given.id;
    assert.equal(given.posts, 1);
    const e = gift(first);
    assert.deepEqual(
      {
        owner_id: e.owner_id,
        source: e.source,
        area: e.area,
        status: e.status,
        granted_by: e.granted_by,
        payment_id: e.payment_id,
        package_id: e.package_id,
        slot_capacity: e.slot_capacity,
        activations_per_period: e.activations_per_period,
        activation_period_days: e.activation_period_days,
        max_photos: e.max_photos,
        max_videos: e.max_videos,
        addon_capabilities: e.addon_capabilities,
      },
      {
        owner_id: thandi.id,
        source: "free_credit",
        area: null,
        status: "active",
        granted_by: admin.id,
        payment_id: null,
        package_id: null,
        slot_capacity: 1,
        activations_per_period: 4,
        activation_period_days: 30,
        max_photos: 10,
        max_videos: 1,
        addon_capabilities: [],
      }
    );
    assert.equal(near(e.ends_at, "now()+interval '30 days'"), "t");
    assert.equal(near(given.ends_at, `'${e.ends_at}'::timestamptz`), "t");
    assert.deepEqual(events(first), [
      {
        entitlement_id: first,
        action: "given",
        actor_id: admin.id,
        posts: 1,
        days: 30,
        ends_at: e.ends_at,
        reason: REASON,
      },
    ]);
    // The member's lists show it; it is not one of the 4 paid Individual slots.
    const mine = json(member(thandi, "select api.get_my_slots_v2();"));
    const listed = mine.slots.find((s) => s.id === first);
    assert.deepEqual(
      [listed.source, listed.individual, listed.renewable, listed.places, listed.state],
      ["free_credit", false, false, 1, "active"]
    );
    assert.deepEqual([mine.individual.held, mine.individual.pending], [0, 0]);
    const manager = json(member(thandi, "select api.get_my_frontend_post_manager();"));
    assert.deepEqual(
      manager.slot_usage.map((s) => [s.id, s.source, s.slotCapacity, s.area]),
      [[first, "FREE_CREDIT", 1, null]]
    );
    // The admin's list: masked email, posts, dates, status, views.
    const item = list().find((g) => g.id === first);
    assert.deepEqual(item, {
      id: first,
      member: `f***@example.invalid`,
      posts: 1,
      starts_at: item.starts_at,
      ends_at: item.ends_at,
      status: "active",
      views: 0,
    });
    assert.equal(near(item.ends_at, `'${e.ends_at}'::timestamptz`), "t");
    // No free first post, payment or invoice.
    assert.deepEqual(freeFirstPost(thandi), { requests: 0, identities: 0, trials: 0 });
    assert.equal(count(`private.payments where owner_id='${thandi.id}'`), 0);
  });

  // LIM-SQL-free-credit-posts, LIM-SQL-free-credit-days and LIM-SQL-free-credit-reason:
  // the bounds pass here and are refused just outside them below.
  await check("bounds: 6 posts, 30 days and a 200-character reason pass", () => {
    const sipho = world.verified("fc-sipho", admin);
    const done = json(giveSql(admin, sipho.email, 6, 1, "a".repeat(200)));
    const e = gift(done.id);
    assert.deepEqual([e.slot_capacity, e.activations_per_period], [6, 24]);
    assert.equal(near(e.ends_at, "now()+interval '1 day'"), "t");
    json(giveSql(admin, sipho.email, 1, 30, "five!"));
  });

  await check("refusals: member, own account, posts, days, reason, staff and second factor", () => {
    const reason = (sql, state, detail) => {
      const refusal = fails(sql, state);
      assert.ok(refusal.includes(detail), refusal);
    };
    reason(
      giveSql(admin, world.user("fc-unverified").email, 1, 30),
      "PT409",
      "free_credit_identity_required"
    );
    reason(
      giveSql(admin, "nobody@example.invalid", 1, 30),
      "PT409",
      "free_credit_member_not_found"
    );
    reason(giveSql(admin, null, 1, 30), "PT409", "free_credit_member_not_found");
    // A suspended (banned) member counts as no active account.
    const banned = world.verified("fc-banned", admin);
    q(`update auth.users set banned_until=now()+interval '1 day' where id='${banned.id}';`);
    reason(giveSql(admin, banned.email, 1, 30), "PT409", "free_credit_member_not_found");
    // The admin's own account, and another account of the same person.
    reason(giveSql(admin, admin.email, 1, 30), "PT409", "free_credit_own_account");
    const twin = world.verified("fc-twin", admin2);
    q(
      `insert into vmtest.identity_alias values('${twin.id}',internal.current_verified_identity('${admin.id}'));`
    );
    reason(giveSql(admin, twin.email, 1, 30), "PT409", "free_credit_own_account");
    q(`delete from vmtest.identity_alias where owner_id='${twin.id}';`);
    for (const posts of [0, 7, "null"])
      reason(giveSql(admin, thandi.email, posts, 30), "22023", "free_credit_posts_invalid");
    for (const days of [0, 31, "null"])
      reason(giveSql(admin, thandi.email, 1, days), "22023", "free_credit_days_invalid");
    for (const text of [null, "", "abcd", "a".repeat(201), "two\nlines", " padded "])
      reason(giveSql(admin, thandi.email, 1, 30, text), "22023", "free_credit_reason_required");
    // Not an admin: a moderator, a governor, a member; a visitor.
    reason(giveSql(moderator, thandi.email, 1, 30), "42501", "capability not granted");
    reason(
      giveSql(world.staffUser("fc-gov", "governor"), thandi.email, 1, 30),
      "42501",
      "capability not granted"
    );
    fails(
      member(thandi, `select api.give_free_credit('${thandi.email}',1,30,'${REASON}');`),
      "42501"
    );
    fails(
      `set role anon;\nselect api.give_free_credit('${thandi.email}',1,30,'${REASON}');`,
      "42501",
      /permission denied/
    );
    // A second-factor code older than 15 minutes: refused for giving, still
    // fine for the list (12 hours), which a 13-hour-old code is not.
    reason(
      giveSql(admin, thandi.email, 1, 30, REASON, now() - 16 * MINUTE),
      "42501",
      "recent second-factor verification required"
    );
    assert.ok(list(admin, now() - 16 * MINUTE).length > 0);
    reason(
      staff(admin, "select api.list_free_credits();", now() - 13 * 60 * MINUTE),
      "42501",
      "staff second-factor verification expired"
    );
    reason(staff(moderator, "select api.list_free_credits();"), "42501", "capability not granted");
    // Nothing was given by any refused call.
    assert.equal(
      count(`private.entitlements where owner_id='${thandi.id}' and source='free_credit'`),
      1
    );
  });

  let post;
  await check("posting with the gift: reviewed and live; the free first post untouched", () => {
    post = draft(thandi);
    const submitted = json(submitSql(thandi, post));
    assert.equal(submitted.status, "pending_moderation");
    assert.equal(fundedBy(post), first);
    q(approveSql(moderator, post));
    assert.equal(row(post).status, "live");
    assert.equal(
      q(`select is_visible from private.post_search_documents where post_id='${post}';`),
      "t"
    );
    assert.equal(
      q(`select max_photos||' '||max_videos from internal.post_funding('${post}');`),
      "10 1"
    );
    // One post: a second waits for capacity and never falls back to the free first post.
    const second = draft(thandi);
    fails(submitSql(thandi, second), "PT409", /all posting capacity is in use/);
    assert.deepEqual(freeFirstPost(thandi), { requests: 0, identities: 0, trials: 0 });
    // The list counts the views of the gift's posts.
    q(`insert into private.post_engagement_totals(post_id,views) values('${post}',42)
       on conflict(post_id) do update set views=42;`);
    assert.equal(list().find((g) => g.id === first).views, 42);
  });

  await check("extending a running gift adds days to its end; the search end follows", () => {
    const before = gift(first).ends_at;
    const done = extend(first, 10);
    assert.equal(near(done.ends_at, `'${before}'::timestamptz+interval '10 days'`), "t");
    const e = gift(first);
    assert.equal(near(e.ends_at, "now()+interval '40 days'"), "t");
    assert.equal(
      q(`select s.visible_until=e.ends_at from private.post_search_documents s, private.entitlements e
         where s.post_id='${post}' and e.id='${first}';`),
      "t"
    );
    const recorded = events(first);
    assert.deepEqual(
      recorded.map((r) => [r.action, r.days, r.posts, r.actor_id]),
      [
        ["given", 30, 1, admin.id],
        ["extended", 10, 1, admin.id],
      ]
    );
    assert.equal(recorded[1].ends_at, e.ends_at);
    // Again and again: no limit on the number of extensions.
    extend(first, 30);
    extend(first, 1);
    assert.equal(near(gift(first).ends_at, "now()+interval '71 days'"), "t");
  });

  await check("extending an ended gift counts from now", () => {
    const amahle = world.verified("fc-amahle", admin);
    const done = give(amahle.email, 2, 5);
    q(`update private.entitlements set starts_at=now()-interval '10 days',ends_at=now()-interval '3 days'
       where id='${done.id}';`);
    assert.equal(list().find((g) => g.id === done.id).status, "ended");
    const again = extend(done.id, 7);
    assert.equal(near(again.ends_at, "now()+interval '7 days'"), "t");
    assert.equal(list().find((g) => g.id === done.id).status, "active");
    assert.deepEqual(
      events(done.id).map((r) => [r.action, r.posts, r.days]),
      [
        ["given", 2, 5],
        ["extended", 2, 7],
      ]
    );
  });

  // LIM-SQL-free-credit-extension-days and LIM-SQL-free-credit-reason (extensions).
  await check("extension refusals", () => {
    const reason = (sql, state, detail) => {
      const refusal = fails(sql, state);
      assert.ok(refusal.includes(detail), refusal);
    };
    const before = gift(first).ends_at;
    for (const days of [0, 31, "null"])
      reason(extendSql(admin, first, days), "22023", "free_credit_days_invalid");
    for (const text of [null, "abcd", "a".repeat(201)])
      reason(extendSql(admin, first, 5, text), "22023", "free_credit_reason_required");
    reason(extendSql(admin, admin.id, 5), "22023", "free_credit_not_found");
    // Another source is not a gift.
    const paidLike =
      q(`insert into private.entitlements(owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at)
      values('${thandi.id}','staff_grant','${admin.id}',1,10,1,now(),now()+interval '5 days') returning id;`);
    reason(extendSql(admin, paidLike, 5), "22023", "free_credit_not_found");
    reason(extendSql(moderator, first, 5), "42501", "capability not granted");
    reason(
      extendSql(admin, first, 5, REASON, now() - 16 * MINUTE),
      "42501",
      "recent second-factor"
    );
    fails(member(thandi, `select api.extend_free_credit('${first}',5,'${REASON}');`), "42501");
    // The member is no longer ID-verified, or is the admin.
    const lindi = world.verified("fc-lindi", admin);
    const hers = give(lindi.email).id;
    q(`update private.accepted_identity_facts set revoked_at=now() where owner_id='${lindi.id}';`);
    reason(extendSql(admin, hers, 5), "PT409", "free_credit_identity_required");
    // A gift of an erased account (revoked, no owner) cannot be extended.
    q(
      `update private.entitlements set status='revoked',revoked_reason='account_erased' where id='${hers}';`
    );
    reason(extendSql(admin, hers, 5), "PT409", "free_credit_closed");
    assert.equal(gift(first).ends_at, before);
  });

  await check("the gift is never a sale: sales figures and the VAT total unchanged", () => {
    assert.deepEqual(sales(), salesBefore);
    assert.equal(count("private.payments"), 0);
    assert.equal(count("private.payment_lines"), 0);
    assert.equal(count("private.invoices"), 0);
    assert.equal(count("private.customer_invoices"), 0);
    assert.equal(count("private.partner_commissions"), 0);
    assert.equal(count("private.house_slot_events"), 0);
  });

  await check("the record is append-only", () => {
    fails(
      `update private.free_credit_events set reason='Changed later' where entitlement_id='${first}';`,
      "23514"
    );
    fails(`delete from private.free_credit_events where entitlement_id='${first}';`, "23514");
    fails("truncate private.free_credit_events;", "23514");
    fails(
      `insert into private.free_credit_events(entitlement_id,action,actor_id,posts,days,ends_at,reason)
         values('${first}','given','${admin.id}',7,30,now(),'${REASON}');`,
      "23514"
    );
    // A gift needs the admin who gave it, and no payment, area or add-ons.
    fails(
      `insert into private.entitlements(owner_id,source,slot_capacity,max_photos,max_videos,starts_at,ends_at)
         values('${thandi.id}','free_credit',1,10,1,now(),now()+interval '1 day');`,
      "23514",
      /entitlements_free_credit_check/
    );
    fails(
      `insert into private.entitlements(owner_id,source,area,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at)
         values('${thandi.id}','free_credit','market','${admin.id}',1,10,1,now(),now()+interval '1 day');`,
      "23514",
      /entitlements_free_credit_check/
    );
  });

  // LIM-F-list_free_credits (at most 500 rows).
  await check("the list shows the latest 500 gifts, newest first", () => {
    q(`insert into private.entitlements(owner_id,source,granted_by,slot_capacity,activations_per_period,max_photos,max_videos,starts_at,ends_at)
       select '${thandi.id}','free_credit','${admin.id}',1,4,10,1,now()-make_interval(days=>30+n),now()-make_interval(days=>n)
       from generate_series(1,500) n;`);
    const items = list();
    assert.equal(items.length, 500);
    assert.ok(items.every((g, i) => i === 0 || g.starts_at <= items[i - 1].starts_at));
    assert.equal(items[0].id, list()[0].id);
  });

  await check("the preflight counts gifts after the update; the rollback refuses", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"]
    );
    assert.match(rows[0][1], APPLIED);
    assert.match(rows[0][1], /gifts: [1-9]/);
    assert.match(fails(kit.rollbackSql, "55000"), /free credits were given/);
  });
});
