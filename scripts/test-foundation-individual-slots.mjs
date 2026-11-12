#!/usr/bin/env node
// Behaviour checks for 20261112174600_individual_slots_r69.sql: Individual
// slots at R69 (roadmap Milestone 11, P2) and no paid plan before the ID review
// is accepted (M3.8).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members quote slots with the production checkout command (as
// `authenticated` with synthetic claims and a live session row); the website's
// server leases, attaches and settles as `service_role` with synthetic Ozow
// request and transaction ids; staff act with a verified authenticator app and
// an AAL2 session. The only stand-in is internal.current_verified_identity,
// which answers with the member's current accepted identity fact (identity
// review has its own suites). The script checks the read-only preflight and
// the update's refusals, applies the update, proves apply -> rollback -> apply
// returns the schema fingerprint to the same values, then checks the pass/fail
// list of P2: price = 6,900 cents x 30-day periods x slots; retired plans cannot
// be bought; no checkout before an accepted ID review; a fifth Individual slot
// is refused, also from a second account of the same identity and while slots
// wait in an open payment; a staff-raised limit (up to 25, only for a checked
// business, only by staff with the capability) and its audit trail; the
// R10,000 online limit (R10,000 exactly is allowed); one slot activates a
// Market, a Business and a Tourism post and its fifth post going live in 30
// days is refused (a rejected submission does not count); refunding one slot of
// a three-slot order withdraws only that slot and its commission; a late
// payment above the limit goes to reconciliation; and the "My slots" read.
//
//   node --import tsx scripts/test-foundation-individual-slots.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Members,
// staff, identity facts, posts and partners are written directly as the
// database owner. Nothing contacts Ozow.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  assertReadOnlyPreflight,
  createChecks,
  sqlHelpers,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261112174600_individual_slots_r69.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");
const PLANS = {
  individual_30d: { id: "d6ca48e5-43be-40df-8d8c-72c98a6fda96", days: 30, cents: 6900 },
  individual_90d: { id: "6a449457-2384-457e-9434-23c2b0e73127", days: 90, cents: 20700 },
  individual_180d: { id: "ce4ef578-344a-4816-ab6a-6961bec46621", days: 180, cents: 41400 },
};
const P30 = PLANS.individual_30d;
const P90 = PLANS.individual_90d;
const P180 = PLANS.individual_180d;
const sha = (text) => createHash("sha256").update(text).digest("hex");
/** A fingerprint of the production form (accepted_identity_facts.identity_hmac). */
const fingerprintOf = (label) =>
  `${createHash("sha256").update(`person-${label}`).digest("base64url").slice(0, 42)}A`;

const { check, current, passed: checks } = createChecks();

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);

  // ---------------------------------------------------------------- helpers
  const { q, json, fails, member, staff, service } = sqlHelpers(database, current);
  const asRole = (role, sql) => `set role ${role};\n${sql}`;
  const fingerprint = () => q(`set search_path to pg_catalog;\n${FINGERPRINT}`);
  const preflight = () =>
    q(PREFLIGHT)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|"));
  const count = (sql) => Number(q(`select count(*) from ${sql};`));

  // ------------------------------------------------------- synthetic world
  q(`create schema vmtest;
    create function vmtest.member(p_label text) returns jsonb language plpgsql as $$
    declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(uid,p_label||'-'||uid||'@example.invalid',now(),jsonb_build_object('display_name','Fixture '||p_label));
      insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
      return jsonb_build_object('id',uid,'session',sid);
    end$$;
    create function vmtest.staff(p_label text,p_role text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      update auth.sessions set aal='aal2' where id=(m->>'session')::uuid;
      insert into auth.mfa_factors(user_id,factor_type,status) values((m->>'id')::uuid,'totp','verified');
      insert into private.staff_roles(user_id,role) values((m->>'id')::uuid,p_role);
      return m;
    end$$;
    -- An accepted ID review with the given fingerprint, a confirmed phone and
    -- an area (their review records are not needed here).
    create function vmtest.verified(p_owner uuid,p_staff uuid,p_fp text) returns void language plpgsql as $$
    begin
      perform set_config('session_replication_role','replica',true);
      insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by)
        values(p_owner,gen_random_uuid(),p_fp,p_staff);
      insert into private.verification_phone_proofs(owner_id,challenge_id,phone)
        values(p_owner,gen_random_uuid(),'+2782'||lpad((abs(hashtext(p_owner::text))%10000000)::text,7,'0'));
      insert into private.verification_localities(owner_id,province_id,city_id) values(p_owner,'gp','gp_johannesburg');
      perform set_config('session_replication_role','origin',true);
    end$$;
    -- The person behind p_from opens a second account: the first account's
    -- review ends and the second is accepted with the same fingerprint.
    create function vmtest.move_identity(p_from uuid,p_to uuid,p_staff uuid) returns void language plpgsql as $$
    declare fp text; begin
      select identity_hmac into fp from private.accepted_identity_facts where owner_id=p_from and revoked_at is null;
      perform set_config('session_replication_role','replica',true);
      update private.accepted_identity_facts set revoked_at=now() where owner_id=p_from and revoked_at is null;
      perform set_config('session_replication_role','origin',true);
      perform vmtest.verified(p_to,p_staff,fp);
    end$$;
    -- A draft post of the kind and area (detail row only; activation needs nothing more).
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
    create or replace function internal.current_verified_identity(p_owner uuid) returns text
      language sql set search_path to 'pg_catalog' as $fn$
      select f.identity_hmac from private.accepted_identity_facts f where f.owner_id=p_owner and f.revoked_at is null
        and exists(select 1 from private.current_account_access a where a.id=p_owner) $fn$;`);
  const user = (label) => json(`select vmtest.member('${label}');`);
  const staffUser = (label, role) => json(`select vmtest.staff('${label}','${role}');`);
  const admin = staffUser("slot-admin", "admin");
  const admin2 = staffUser("slot-admin2", "admin");
  const moderator = staffUser("slot-moderator", "moderator");
  const verified = (label) => {
    const m = user(label);
    m.fingerprint = fingerprintOf(label);
    q(`select vmtest.verified('${m.id}','${admin.id}','${m.fingerprint}');`);
    return m;
  };
  const post = (owner, kind, area) => q(`select vmtest.post('${owner.id}','${kind}','${area}');`);
  const activateSql = (owner, id) => member(owner, `select api.activate_post('${id}');`);
  const activate = (owner, id) => json(activateSql(owner, id));
  const release = (id, reason = "deleted") =>
    q(
      `update private.post_activations set released_at=clock_timestamp(),release_reason='${reason}' where post_id='${id}' and released_at is null;`
    );

  /** The member's quote: the slot checkout command the website calls. */
  const quoteSql = (owner, plan, slots, expected = plan.cents * slots, consent = "true") =>
    member(owner, `select api.start_slot_checkout('${plan.id}',${slots},${expected},${consent});`);
  const quote = (...args) => json(quoteSql(...args));
  /** The server's lease and the Ozow request it attaches. */
  const open = (owner, paymentId) => {
    const lease = json(service(`select api.claim_checkout_request('${paymentId}','${owner.id}');`));
    if (lease.checkout_url) return lease;
    q(
      service(
        `select api.complete_checkout_request('${paymentId}','${owner.id}','${lease.claim_token}','req-${paymentId}','https://one.ozow.com/checkout/req-${paymentId}');`
      )
    );
    return lease;
  };
  /** Ozow's confirmed payment, applied as the notice handler does. */
  const settle = (owner, paymentId) => {
    open(owner, paymentId);
    const row = json(
      `select jsonb_build_object('ref',merchant_reference,'amount',amount_cents) from private.payments where id='${paymentId}';`
    );
    const event = {
      payload_sha256: sha(`event-${paymentId}`),
      merchant_reference: row.ref,
      provider_request_id: `req-${paymentId}`,
      provider_transaction_id: `tx-${paymentId}`,
      status: "complete",
      amount_cents: Number(row.amount),
      currency: "ZAR",
    };
    return json(service(`select api.apply_provider_event($e$${JSON.stringify(event)}$e$::jsonb);`));
  };
  const buy = (owner, plan, slots) => {
    const quoted = quote(owner, plan, slots);
    const settled = settle(owner, quoted.payment_id);
    assert.equal(settled.outcome, "completed", JSON.stringify(settled));
    return quoted.payment_id;
  };
  const lines = (paymentId) =>
    json(
      `select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'n',l.line_number,'amount',l.amount_cents,'status',l.status,
         'entitlement',(select e.id from private.entitlements e where e.payment_line_id=l.id),
         'entitlement_status',(select e.status from private.entitlements e where e.payment_line_id=l.id)) order by l.line_number),'[]')
       from private.payment_lines l where l.payment_id='${paymentId}';`
    );
  const paymentRow = (paymentId) =>
    json(
      `select jsonb_build_object('status',status,'fulfillment',fulfillment_status,'amount',amount_cents,'snapshot',snapshot) from private.payments where id='${paymentId}';`
    );
  const slotsOf = (owner) => json(member(owner, "select api.get_my_slots();"));

  // ------------------------------------------------------------ before
  await check("before the update: nothing on sale, preflight reads 'not applied'", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^individual slots: update not applied \(apply before the website release that uses it is deployed\); current posting terms: posting-v4; on sale: nothing; plan payments pending: 0; slot payment lines: none \(table absent\)$/
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
    const someone = user("before");
    fails(quoteSql(someone, P30, 1), "42883");
  });
  await check("the update refuses without posting-v4 and with another plan on sale", () => {
    const before = fingerprint();
    q("update private.posting_terms_current set version='posting-v3' where singleton;");
    assert.match(fails(step.sql, "55000"), /posting-v4 must be current/);
    assert.match(preflight()[1][1], /current posting terms are posting-v3/);
    q("update private.posting_terms_current set version='posting-v4' where singleton;");
    q(`insert into private.plan_versions(plan_code,version,area,label,price_cents,duration_days,slot_capacity,max_photos,max_videos)
       values('probe_30d',1,'market','Probe',5000,30,1,10,1);`);
    assert.match(fails(step.sql, "55000"), /another plan is on sale \(probe_30d@1\)/);
    q("update private.plan_versions set retired_at=now() where plan_code='probe_30d';");
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  const before = fingerprint();
  applySteps(database, [step]);
  const after = fingerprint();

  await check("apply, roll back and apply again are clean", () => {
    assert.notEqual(after, before);
    assert.deepEqual(
      preflight().map((r) => r[0]),
      ["summary"]
    );
    assert.match(
      preflight()[0][1],
      /^individual slots: already applied; current posting terms: posting-v4; on sale: individual_30d@1 6900 cents, individual_90d@1 20700 cents, individual_180d@1 41400 cents; plan payments pending: 0; slot payment lines: 0$/
    );
    applySteps(database, [{ label: "individual slots rollback", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before, "the rollback leaves the pre-update schema");
    assert.equal(count("private.plan_versions where is_public and retired_at is null"), 0);
    assert.match(preflight()[0][1], /^individual slots: update not applied/);
    // The retired rows are history: applying again needs new plan versions.
    assert.match(fails(step.sql, "55000"), /taken off sale \(by the rollback\)/);
    assert.equal(fingerprint(), before);
    // A fresh catalogue (this database only) lets the same update apply again.
    q(`alter table private.plan_versions disable trigger plan_versions_immutable;
      delete from private.plan_versions where plan_code like 'individual\\_%';
      alter table private.plan_versions enable trigger plan_versions_immutable;`);
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
  });

  // ------------------------------------------------------------- catalogue
  await check(
    "the catalogue: three Individual slots for any area at 6,900 cents per 30 days",
    () => {
      const catalogue = json(asRole("anon", "select api.billing_catalogue();"));
      assert.deepEqual(
        catalogue.plans.map((p) => [p.code, p.id, p.area, p.price_cents, p.duration_days]),
        Object.entries(PLANS).map(([code, p]) => [code, p.id, null, String(p.cents), p.days])
      );
      for (const p of catalogue.plans) {
        assert.equal(Number(p.price_cents), 6900 * (p.duration_days / 30), p.code);
        assert.equal(p.slot_capacity, 1);
        assert.equal(p.activations_per_period, 4);
        assert.equal(p.activation_period_days, 30);
        assert.equal(p.max_photos, 10);
        assert.equal(p.max_videos, 1);
      }
    }
  );

  await check("price = 6,900 cents x 30-day periods x slots, one line per slot", () => {
    const thandi = verified("thandi");
    for (const [plan, slots] of [
      [P30, 1],
      [P90, 1],
      [P180, 1],
    ]) {
      const quoted = quote(thandi, plan, slots);
      assert.equal(quoted.amount_cents, String(6900 * (plan.days / 30) * slots));
      assert.equal(quoted.slots, slots);
      assert.equal(quoted.reused, false);
      const recorded = lines(quoted.payment_id);
      assert.deepEqual(
        recorded.map((l) => [l.n, l.amount, l.status]),
        [[1, plan.cents, "open"]]
      );
      q(`update private.payments set status='cancelled' where id='${quoted.payment_id}';`);
    }
    const three = quote(thandi, P90, 3);
    assert.equal(three.amount_cents, String(6900 * 3 * 3));
    assert.deepEqual(
      lines(three.payment_id).map((l) => [l.n, l.amount]),
      [
        [1, 20700],
        [2, 20700],
        [3, 20700],
      ]
    );
    const snap = paymentRow(three.payment_id).snapshot;
    assert.equal(snap.category, "individual");
    assert.equal(snap.slots, 3);
    assert.equal(snap.total_cents, 62100);
    assert.equal(snap.invoice_description, "3 × Individual slot — 90 days");
    assert.equal(snap.cooling_off_consent.terms_version, "posting-v4");
    assert.equal(
      snap.cooling_off_consent.wording,
      "My slot starts now; the 7-day cooling-off does not apply because the service starts immediately"
    );
    // The total the member was shown must be the total charged.
    fails(quoteSql(thandi, P30, 2, 13801), "PT428", /the price changed/);
    q(`update private.payments set status='cancelled' where id='${three.payment_id}';`);
  });

  await check("retired plans and the old checkout cannot sell a plan", () => {
    const sipho = verified("sipho");
    const retired = q(
      "select id from private.plan_versions where plan_code='market_30d' and version=1;"
    );
    assert.match(retired, /^[0-9a-f-]{36}$/);
    fails(
      member(sipho, `select api.start_slot_checkout('${retired}',1,5000,true);`),
      "22023",
      /this slot is not on sale/
    );
    fails(
      member(sipho, `select api.start_checkout('${retired}',null);`),
      "22023",
      /slots are bought with the slot checkout/
    );
    fails(
      member(sipho, `select api.start_checkout('${P30.id}',null);`),
      "22023",
      /slots are bought with the slot checkout/
    );
    const addon = q("select id from private.addon_versions where kind='urgent' limit 1;");
    fails(
      member(sipho, `select api.start_slot_checkout('${addon}',1,1000,true);`),
      "22023",
      /this slot is not on sale/
    );
    assert.equal(count(`private.payments where owner_id='${sipho.id}'`), 0);
  });

  await check(
    "no slot checkout before the ID review is accepted (M3.8), nor without consent",
    () => {
      const lerato = user("lerato");
      fails(quoteSql(lerato, P30, 1), "PT412", /your ID review must be accepted/);
      fails(asRole("anon", `select api.start_slot_checkout('${P30.id}',1,6900,true);`), "42501");
      const naledi = verified("naledi");
      fails(quoteSql(naledi, P30, 1, 6900, "false"), "22023", /cooling-off consent required/);
      fails(quoteSql(naledi, P30, 1, 6900, "null"), "22023", /cooling-off consent required/);
      fails(quoteSql(naledi, P30, 0, 0), "22023");
      fails(quoteSql(naledi, P30, 26, 6900 * 26), "22023");
      assert.equal(count(`private.payments where owner_id in ('${lerato.id}','${naledi.id}')`), 0);
      // Once accepted, the same member can buy.
      q(`select vmtest.verified('${lerato.id}','${admin.id}','${fingerprintOf("lerato")}');`);
      assert.equal(quote(lerato, P30, 1).amount_cents, "6900");
    }
  );

  // ------------------------------------------------------------- the limit
  let amahle;
  await check(
    "a fifth Individual slot is refused, also from a second account of the same person",
    () => {
      amahle = verified("amahle");
      const first = buy(amahle, P30, 3);
      assert.equal(paymentRow(first).fulfillment, "fulfilled");
      const delivered = lines(first);
      assert.equal(delivered.length, 3);
      assert.ok(delivered.every((l) => l.entitlement && l.entitlement_status === "active"));
      assert.equal(new Set(delivered.map((l) => l.entitlement)).size, 3);
      buy(amahle, P90, 1);
      assert.equal(slotsOf(amahle).individual.held, 4);
      for (const plan of [P30, P90, P180])
        fails(quoteSql(amahle, plan, 1), "PT429", /at most 4 Individual slots/);
      // The same person on a second account.
      const second = user("amahle-two");
      q(`select vmtest.move_identity('${amahle.id}','${second.id}','${admin.id}');`);
      fails(quoteSql(second, P30, 1), "PT429", /at most 4 Individual slots/);
      assert.equal(slotsOf(second).individual.held, 4);
      // Another person is not affected.
      assert.equal(quote(verified("bongani"), P30, 4).amount_cents, String(4 * 6900));
    }
  );

  await check(
    "slots waiting in an open payment count; a payment for another count is replaced",
    () => {
      const zola = verified("zola");
      const waiting = quote(zola, P30, 3);
      open(zola, waiting.payment_id);
      fails(quoteSql(zola, P90, 2), "PT429", /at most 4 Individual slots/);
      const one = quote(zola, P90, 1);
      assert.equal(one.amount_cents, "20700");
      // Same plan, same count: the open payment is reused.
      const again = quote(zola, P30, 3);
      assert.equal(again.payment_id, waiting.payment_id);
      assert.equal(again.reused, true);
      // Same plan, another count, already at Ozow: returned so the member
      // continues, checks or cancels it.
      const atOzow = quote(zola, P30, 2);
      assert.equal(atOzow.payment_id, waiting.payment_id);
      assert.equal(atOzow.slots, 3);
      assert.equal(atOzow.amount_cents, String(3 * 6900));
      // Never sent to Ozow: replaced.
      q(`update private.payments set status='cancelled' where id='${waiting.payment_id}';`);
      const unsent = quote(zola, P30, 2);
      const replaced = quote(zola, P30, 1);
      assert.notEqual(replaced.payment_id, unsent.payment_id);
      assert.equal(replaced.reused, false);
      assert.equal(paymentRow(unsent.payment_id).status, "cancelled");
      // An open checkout window that has passed no longer holds slots.
      q(
        `update private.payments set checkout_expires_at=clock_timestamp()-interval '1 minute',created_at=created_at-interval '1 hour' where id='${one.payment_id}';`
      );
      q(
        `update private.payments set created_at=created_at-interval '1 hour' where id='${replaced.payment_id}';`
      );
      assert.equal(quote(zola, P180, 4).amount_cents, String(4 * 41400));
    }
  );

  // ------------------------------------------------------ staff-raised limit
  let khaya;
  await check("only staff with the capability raise a limit, only for a checked business", () => {
    khaya = verified("khaya");
    const ends = "now()+interval '200 days'";
    const raise = (who, limit, endsAt = ends, account = khaya) =>
      staff(
        who,
        `select api.staff_set_individual_slot_limit('${account.id}',${limit},${endsAt},'Interim limit for a checked dealer');`
      );
    fails(
      member(
        khaya,
        `select api.staff_set_individual_slot_limit('${khaya.id}',25,${ends},'Raise my own limit');`
      ),
      "42501"
    );
    fails(raise(moderator, 25), "42501", /capability not granted/);
    fails(raise(admin, 25), "PT409", /more than 4 slots need a checked business/);
    // A live business profile is a checked business.
    const business = post(khaya, "business", "business");
    q(
      `update private.posts set status='live',published_at=now()-interval '1 day',visible_until=now()+interval '20 days' where id='${business}';`
    );
    for (const bad of ["26", "3", "null"]) fails(raise(admin, bad), "22023");
    fails(raise(admin, 25, "now()+interval '400 days'"), "22023");
    fails(raise(admin, 25, "null"), "22023");
    fails(raise(admin, 4, ends), "22023");
    // Nobody raises their own limit, staff included.
    q(`select vmtest.verified('${admin2.id}','${admin.id}','${fingerprintOf("admin2")}');`);
    fails(raise(admin2, 10, ends, admin2), "42501", /a different staff member/);
    const first = json(raise(admin, 10));
    assert.equal(first.slot_limit, 10);
    const second = json(raise(admin2, 25));
    assert.equal(second.slot_limit, 25);
    assert.equal(second.held, 0);
    const audit = json(
      `select jsonb_agg(jsonb_build_object('limit',slot_limit,'by',granted_by,'ended_by',revoked_by,'reason',reason) order by granted_at,slot_limit)
       from private.individual_slot_limits where account_id='${khaya.id}';`
    );
    assert.deepEqual(audit, [
      {
        limit: 10,
        by: admin.id,
        ended_by: admin2.id,
        reason: "Interim limit for a checked dealer",
      },
      { limit: 25, by: admin2.id, ended_by: null, reason: "Interim limit for a checked dealer" },
    ]);
    fails(
      `update private.individual_slot_limits set slot_limit=24 where account_id='${khaya.id}' and revoked_at is null;`,
      "23514"
    );
    fails(`delete from private.individual_slot_limits where account_id='${khaya.id}';`, "23514");
  });

  await check("a raised limit allows up to 25 slots and the R10,000 online limit holds", () => {
    // 25 x 180 days = R10,350: above R10,000, refused online (ask for an invoice).
    fails(quoteSql(khaya, P180, 25), "PT413", /paid by invoice/);
    assert.equal(count(`private.payments where owner_id='${khaya.id}'`), 0);
    // 24 x 180 days = R9,936 stays online.
    const big = quote(khaya, P180, 24);
    assert.equal(big.amount_cents, "993600");
    q(`update private.payments set status='cancelled' where id='${big.payment_id}';`);
    buy(khaya, P30, 20);
    buy(khaya, P30, 4);
    fails(quoteSql(khaya, P30, 2), "PT429", /at most 25 Individual slots/);
    buy(khaya, P30, 1);
    assert.equal(slotsOf(khaya).individual.held, 25);
    assert.equal(slotsOf(khaya).individual.limit, 25);
    fails(quoteSql(khaya, P30, 1), "PT429", /at most 25 Individual slots/);
    // R10,000 exactly is online: a test-only price of R400 x 25 slots.
    q(`insert into private.plan_versions(plan_code,version,area,label,price_cents,duration_days,slot_capacity,
         activations_per_period,max_photos,max_videos) values('individual_30d',9,null,'Boundary probe',40000,30,1,4,10,1);`);
    const boundary = q(
      "select id from private.plan_versions where plan_code='individual_30d' and version=9;"
    );
    const dealer = verified("dealer");
    const dealerBusiness = post(dealer, "business", "business");
    q(
      `update private.posts set status='live',published_at=now()-interval '1 day',visible_until=now()+interval '20 days' where id='${dealerBusiness}';`
    );
    q(
      staff(
        admin,
        `select api.staff_set_individual_slot_limit('${dealer.id}',25,now()+interval '30 days','Boundary dealer limit');`
      )
    );
    const exact = json(
      member(dealer, `select api.start_slot_checkout('${boundary}',25,1000000,true);`)
    );
    assert.equal(exact.amount_cents, "1000000");
    q(`update private.payments set status='cancelled' where id='${exact.payment_id}';`);
    q(
      "update private.plan_versions set retired_at=now() where plan_code='individual_30d' and version=9;"
    );
    // Ending the raise: existing slots run on, new purchases follow the limit of 4.
    assert.equal(
      json(
        staff(
          admin,
          `select api.staff_set_individual_slot_limit('${khaya.id}',4,null,'Business tools launched');`
        )
      ).slot_limit,
      4
    );
    assert.equal(slotsOf(khaya).individual.held, 25);
    fails(quoteSql(khaya, P30, 1), "PT429", /at most 4 Individual slots/);
  });

  // ------------------------------------------------------- one slot, any area
  await check(
    "one slot activates a Market, a Business and a Tourism post; the fifth in 30 days is refused",
    () => {
      const sibu = verified("sibu");
      const paymentId = buy(sibu, P30, 1);
      const [slot] = lines(paymentId);
      const market = post(sibu, "listing", "market");
      const business = post(sibu, "business", "business");
      const tourism = post(sibu, "business", "tourism_events");
      for (const id of [market, business, tourism]) {
        const activated = activate(sibu, id);
        assert.equal(activated.entitlement_id, slot.entitlement, id);
        assert.equal(activated.reused, false);
        // Its one place is taken until the post is deleted.
        fails(activateSql(sibu, post(sibu, "listing", "market")), "PT409");
        release(id);
      }
      // A submission that review rejected never went live: it does not count.
      const rejected = post(sibu, "listing", "market");
      activate(sibu, rejected);
      release(rejected, "moderation");
      const fourth = post(sibu, "listing", "market");
      assert.equal(activate(sibu, fourth).entitlement_id, slot.entitlement);
      release(fourth);
      const fifth = post(sibu, "listing", "market");
      fails(activateSql(sibu, fifth), "PT409", /all posting capacity is in use/);
      assert.equal(count(`private.post_activations where post_id='${fifth}'`), 0);
      // An ended post brought back counts too: after the 30 days, it works again.
      q(
        `update private.post_activations set activated_at=activated_at-interval '31 days' where entitlement_id='${slot.entitlement}';`
      );
      assert.equal(activate(sibu, market).entitlement_id, slot.entitlement);
    }
  );

  // --------------------------------------------------- one slot refunded alone
  await check(
    "refunding one slot of a three-slot order withdraws only that slot and its commission",
    () => {
      const partner = user("partner");
      const buyer = verified("buyer");
      q(`select set_config('session_replication_role','replica',false);
      insert into private.partners(account_id,code,status,commission_bps,created_by)
        values('${partner.id}','PARTNER9','active',2000,'${admin.id}');
      insert into private.account_acquisitions(account_id,source,partner_id)
        values('${buyer.id}','partner',(select id from private.partners where account_id='${partner.id}'));
      select set_config('session_replication_role','origin',false);`);
      const paymentId = buy(buyer, P30, 3);
      const commissions = () =>
        json(
          `select jsonb_agg(jsonb_build_object('line',c.payment_line_id,'base',c.base_cents,'amount',c.amount_cents,'status',c.status) order by l.line_number)
         from private.partner_commissions c join private.payment_lines l on l.id=c.payment_line_id where c.payment_id='${paymentId}';`
        );
      const slots = lines(paymentId);
      assert.deepEqual(
        commissions().map((c) => [c.line, c.base, c.amount, c.status]),
        slots.map((l) => [l.id, 6900, 1380, "pending"])
      );
      // A post in one of the slots.
      const listing = post(buyer, "listing", "market");
      const used = activate(buyer, listing).entitlement_id;
      q(
        `update private.posts set status='live',published_at=now(),visible_until=now()+interval '20 days' where id='${listing}';`
      );
      const target = slots.find((l) => l.entitlement === used);
      const reverse = (who, line, reason = "Billing error on one slot") =>
        staff(who, `select api.record_staff_slot_reversal('${line}','refunded','${reason}');`);
      fails(
        member(
          buyer,
          `select api.record_staff_slot_reversal('${target.id}','refunded','Refund my slot please');`
        ),
        "42501"
      );
      fails(reverse(moderator, target.id), "42501", /capability not granted/);
      const result = json(reverse(admin, target.id));
      assert.deepEqual(
        [result.status, result.released_activations, result.payment_status, result.repeated],
        ["refunded", 1, "complete", false]
      );
      const after = lines(paymentId);
      assert.deepEqual(
        after.map((l) => [l.id === target.id, l.status, l.entitlement_status]),
        slots.map((l) =>
          l.id === target.id ? [true, "reversed", "revoked"] : [false, "open", "active"]
        )
      );
      assert.deepEqual(
        commissions().map((c) => [c.line === target.id, c.status]),
        slots.map((l) => [l.id === target.id, l.id === target.id ? "reversed" : "pending"])
      );
      assert.equal(q(`select status from private.posts where id='${listing}';`), "expired");
      assert.equal(paymentRow(paymentId).status, "complete");
      assert.equal(
        count(`private.outbox_events where dedupe_key='payment_line_reversed:${target.id}'`),
        1
      );
      // The same staff member repeating the same reversal changes nothing; anything else is refused.
      assert.equal(json(reverse(admin, target.id)).repeated, true);
      fails(reverse(admin, target.id, "Another reason entirely"), "PT409", /already reversed/);
      fails(reverse(admin2, target.id), "PT409", /already reversed/);
      // The whole payment can no longer be reversed in one go.
      fails(
        service(`select api.reverse_payment('${paymentId}','refunded','Whole order refund');`),
        "PT409",
        /reverse its other slots one by one/
      );
      // The buyer keeps two slots.
      assert.equal(slotsOf(buyer).individual.held, 2);
      // The last two: the payment itself becomes refunded.
      const rest = slots.filter((l) => l.id !== target.id);
      assert.equal(json(reverse(admin, rest[0].id)).payment_status, "complete");
      assert.equal(json(reverse(admin2, rest[1].id)).payment_status, "refunded");
      assert.deepEqual(
        [paymentRow(paymentId).status, paymentRow(paymentId).fulfillment],
        ["refunded", "reversed"]
      );
      assert.ok(commissions().every((c) => c.status === "reversed"));
      // Nobody reverses a slot of their own payment.
      const staffBuyer = admin2;
      const own = quote(staffBuyer, P30, 1);
      settle(staffBuyer, own.payment_id);
      fails(reverse(admin2, lines(own.payment_id)[0].id), "42501", /a different staff member/);
    }
  );

  await check("staff never raise a limit for, or reverse a payment of, their own identity", () => {
    // admin2's own review moves to a second account of the same person.
    const second = user("admin2-second");
    q(`select vmtest.move_identity('${admin2.id}','${second.id}','${admin.id}');`);
    const business = post(second, "business", "business");
    q(
      `update private.posts set status='live',published_at=now()-interval '1 day',visible_until=now()+interval '20 days' where id='${business}';`
    );
    fails(
      staff(
        admin2,
        `select api.staff_set_individual_slot_limit('${second.id}',10,now()+interval '30 days','Raise for my other account');`
      ),
      "42501",
      /a different staff member/
    );
    const order = buy(second, P30, 1);
    fails(
      staff(
        admin2,
        `select api.record_staff_slot_reversal('${lines(order)[0].id}','refunded','Refund my other account');`
      ),
      "42501",
      /a different staff member/
    );
    fails(
      staff(
        admin2,
        `select api.record_frontend_staff_payment_reversal('${order}','refunded','Refund my other account');`
      ),
      "42501",
      /a different staff member/
    );
    // Another staff member may.
    assert.equal(
      json(
        staff(
          admin,
          `select api.record_staff_slot_reversal('${lines(order)[0].id}','refunded','Billing error on one slot');`
        )
      ).payment_status,
      "refunded"
    );
  });

  await check("a whole-payment reversal reverses every slot and its commissions", () => {
    const whole = verified("whole");
    const paymentId = buy(whole, P90, 2);
    q(
      service(`select api.reverse_payment('${paymentId}','chargeback','Bank chargeback received');`)
    );
    assert.deepEqual(
      lines(paymentId).map((l) => [l.status, l.entitlement_status]),
      [
        ["reversed", "revoked"],
        ["reversed", "revoked"],
      ]
    );
    assert.equal(slotsOf(whole).individual.held, 0);
  });

  await check(
    "a late payment above the limit is recorded and goes to staff, never delivered",
    () => {
      const gugu = verified("gugu");
      const referrer = user("referrer");
      q(`select set_config('session_replication_role','replica',false);
      insert into private.partners(account_id,code,status,commission_bps,created_by)
        values('${referrer.id}','PARTNER7','active',2000,'${admin.id}');
      insert into private.account_acquisitions(account_id,source,partner_id)
        values('${gugu.id}','partner',(select id from private.partners where account_id='${referrer.id}'));
      select set_config('session_replication_role','origin',false);`);
      buy(gugu, P30, 3);
      const late = quote(gugu, P30, 1);
      open(gugu, late.payment_id);
      // Its checkout window passes, so it no longer holds a slot ...
      q(
        `update private.payments set checkout_expires_at=clock_timestamp()-interval '1 minute' where id='${late.payment_id}';`
      );
      // ... and the member buys the fourth slot elsewhere.
      buy(gugu, P180, 1);
      const settled = settle(gugu, late.payment_id);
      assert.equal(settled.outcome, "complete_unfulfillable_target");
      assert.equal(settled.fulfillment_status, "needs_reconciliation");
      assert.equal(lines(late.payment_id)[0].entitlement, null);
      assert.equal(slotsOf(gugu).individual.held, 4);
      assert.equal(
        count(
          `private.outbox_events where dedupe_key='payment_reconciliation_required:${late.payment_id}'`
        ),
        1
      );
      // Money that delivered nothing earns no commission; delivered slots do.
      assert.equal(count(`private.partner_commissions where payment_id='${late.payment_id}'`), 0);
      assert.equal(
        count(
          `private.partner_commissions c join private.payments p on p.id=c.payment_id where p.owner_id='${gugu.id}'`
        ),
        4
      );
    }
  );

  await check("slots of an account that may not use them do not block the person", () => {
    // amahle's first account holds 4 slots; the person now uses a second
    // account (moved earlier). Once the first account is banned (for example
    // an impostor's), its slots no longer count.
    const second = q(
      `select f.owner_id from private.accepted_identity_facts f where f.identity_hmac='${fingerprintOf("amahle")}' and f.revoked_at is null;`
    );
    const secondMember = json(
      `select jsonb_build_object('id',u.id,'session',(select s.id from auth.sessions s where s.user_id=u.id limit 1)) from auth.users u where u.id='${second}';`
    );
    fails(quoteSql(secondMember, P30, 1), "PT429");
    q(`update auth.users set banned_until=now()+interval '30 days' where id='${amahle.id}';`);
    assert.equal(slotsOf(secondMember).individual.held, 0);
    assert.equal(quote(secondMember, P30, 4).amount_cents, String(4 * 6900));
    q(`update auth.users set banned_until=null where id='${amahle.id}';`);
  });

  await check("staff can end a raise after the person's review lapsed", () => {
    const lapsing = verified("lapsing");
    const shop = post(lapsing, "business", "business");
    q(
      `update private.posts set status='live',published_at=now()-interval '1 day',visible_until=now()+interval '20 days' where id='${shop}';`
    );
    q(
      staff(
        admin,
        `select api.staff_set_individual_slot_limit('${lapsing.id}',12,now()+interval '60 days','Interim limit for a checked dealer');`
      )
    );
    // The review ends (for example the evidence was replaced).
    q(`select set_config('session_replication_role','replica',false);
      update private.accepted_identity_facts set revoked_at=now() where owner_id='${lapsing.id}' and revoked_at is null;
      select set_config('session_replication_role','origin',false);`);
    fails(
      staff(
        admin,
        `select api.staff_set_individual_slot_limit('${lapsing.id}',20,now()+interval '60 days','Raise after the review lapsed');`
      ),
      "PT409",
      /ID review must be accepted/
    );
    assert.equal(
      json(
        staff(
          admin,
          `select api.staff_set_individual_slot_limit('${lapsing.id}',4,null,'Business tools launched');`
        )
      ).slot_limit,
      4
    );
    assert.equal(
      count(
        `private.individual_slot_limits where account_id='${lapsing.id}' and revoked_at is null`
      ),
      0
    );
  });

  // ---------------------------------------------------------------- my slots
  await check("My slots: every slot with its post, ended slots for 3 days, the counts", () => {
    const mpho = verified("mpho");
    buy(mpho, P30, 2);
    const listing = post(mpho, "listing", "market");
    activate(mpho, listing);
    // A free week (intro trial) is listed but is not an Individual slot.
    q(`insert into private.entitlements(owner_id,source,slot_capacity,max_photos,max_videos,starts_at,ends_at)
       values('${mpho.id}','intro_trial',1,10,1,now(),now()+interval '7 days');`);
    // A slot that ended 2 days ago (its post kept for 3 days) and one 4 days ago.
    const ended = buy(mpho, P30, 1);
    const kept = post(mpho, "listing", "market");
    const endedSlot = lines(ended)[0].entitlement;
    q(`insert into private.post_activations(post_id,entitlement_id,owner_id,activated_at,released_at,release_reason)
         values('${kept}','${endedSlot}','${mpho.id}',now()-interval '32 days',now()-interval '2 days','expired');
       update private.entitlements set starts_at=now()-interval '32 days',ends_at=now()-interval '2 days' where id='${endedSlot}';
       update private.posts set status='live',published_at=now()-interval '30 days',visible_until=now()+interval '1 day' where id='${kept}';
       update private.posts set status='expired' where id='${kept}';`);
    const old = buy(mpho, P30, 1);
    q(
      `update private.entitlements set starts_at=now()-interval '34 days',ends_at=now()-interval '4 days' where id='${lines(old)[0].entitlement}';`
    );
    const mine = slotsOf(mpho);
    assert.deepEqual(mine.individual, {
      verified: true,
      held: 2,
      pending: 0,
      limit: 4,
      limit_ends_at: null,
    });
    const active = mine.slots.filter((s) => s.state === "active");
    assert.equal(active.length, 3);
    assert.deepEqual(active.map((s) => [s.source, s.individual]).sort(), [
      ["intro_trial", false],
      ["retail_paid", true],
      ["retail_paid", true],
    ]);
    const holding = active.find((s) => s.posts.length === 1);
    assert.equal(holding.posts[0].id, listing);
    assert.equal(holding.label, "Individual slot — 30 days");
    assert.equal(holding.area, null);
    assert.equal(holding.places, 1);
    const endedRows = mine.slots.filter((s) => s.state === "ended");
    assert.equal(endedRows.length, 1, JSON.stringify(mine.slots));
    assert.equal(endedRows[0].id, endedSlot);
    assert.deepEqual(
      endedRows[0].posts.map((p) => [p.id, p.status]),
      [[kept, "expired"]]
    );
    assert.ok(endedRows[0].posts[0].deletes_at);
    // Only the member's own slots.
    assert.equal(slotsOf(verified("stranger")).slots.length, 0);
    fails(asRole("anon", "select api.get_my_slots();"), "42501");
    assert.equal(slotsOf(user("unverified")).individual.verified, false);
  });

  await check(
    "grants: members call the member commands, staff commands check staff, helpers are closed",
    () => {
      const grants = json(
        "select jsonb_object_agg(r.rolname||' '||f.sig,has_function_privilege(r.rolname,f.sig,'execute')) " +
          "from (values('anon'),('authenticated'),('service_role')) r(rolname), " +
          "(values('api.start_slot_checkout(uuid,integer,bigint,boolean)'),('api.get_my_slots()')," +
          "('api.record_staff_slot_reversal(uuid,text,text)'),('api.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text)')," +
          "('internal.individual_slots_counted(text,uuid,uuid)'),('internal.individual_slot_limit(text)')) f(sig);"
      );
      for (const [key, value] of Object.entries(grants)) {
        const [role, sig] = key.split(" ");
        const expected = role === "authenticated" && sig.startsWith("api.");
        assert.equal(value, expected, key);
      }
      for (const table of ["private.payment_lines", "private.individual_slot_limits"])
        assert.equal(
          q(
            `select bool_or(has_table_privilege(r,'${table}','select,insert,update,delete')) from unnest(array['anon','authenticated','service_role']) r;`
          ),
          "f",
          table
        );
      fails("update private.payment_lines set amount_cents=1 where line_number=1;", "23514");
    }
  );

  await check("the rollback refuses once a slot was ordered", () => {
    const now = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /slots were already ordered/);
    assert.equal(fingerprint(), now);
    assert.match(
      preflight()[0][1],
      /^individual slots: already applied; .*slot payment lines: [1-9][0-9]*$/
    );
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the slot checkout and its limit", () => {
      const later1 = verified("later");
      buy(later1, P30, 4);
      fails(quoteSql(later1, P30, 1), "PT429");
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Individual slot checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
