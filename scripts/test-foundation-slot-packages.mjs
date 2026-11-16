#!/usr/bin/env node
// Behaviour checks for 20261114154823_slot_packages.sql: Multi-listing
// packages, part one (roadmap P4a): the package record, buying a package
// online and posts in its places, with sales switched off by default.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members buy with the production package checkout (as `authenticated`
// with synthetic claims and a live session row); the website's server leases,
// attaches and settles as `service_role` with synthetic Ozow request and
// transaction ids; staff act with a verified authenticator app and an AAL2
// session. Time is moved by shifting a member's own dates back (vmtest.travel),
// as if days had passed. The only stand-in is internal.current_verified_identity,
// which answers with the member's current accepted identity fact. The sales
// switch is turned on for the purchase checks the way the owner would: one
// reviewed SQL statement as the database owner.
//
// It checks the read-only preflight and the update's refusals, applies the
// update, proves apply -> rollback -> apply returns the schema fingerprint to
// the same values, then: with the switch off nothing can be bought and the
// offer lists no terms; the typed number of slots (4 refused, 5 and 100
// bought, 101 and 251 refused) and the R10,000 online limit for each term
// (33 x 90 days and 16 x 180 days online, 34 and 17 by invoice); the shown
// total and the "starts now" consent; an accepted ID review; a paid package
// is one payment with one line, opens one package whose grant carries every
// slot and ends exactly its term after the payment; an Ozow notice replayed or
// with another amount changes nothing; one package per account (checkout, a
// late second payment sent to reconciliation, staff activation refused);
// posts use the package's places, at most the number of slots, also when two
// activations race for the last place; the 4 posts going live per slot per 30
// days count over the whole package; while a package runs no Individual slot
// can be bought or renewed, but in its last 7 days it can; when an Individual
// slot ends, the package takes its post if it has a free place, read at the
// moment it ends (public view, restorable view, search, post page, funding)
// before any job runs, the sweep then moves it in without it counting as a new
// post, and a full package leaves it to the 3-day grace; another account
// cannot see or use the package, and no team member is added to its grant;
// partner commission is 20% of the package once and is reversed by a refund;
// a refund or chargeback withdraws the package and its posts; the grants; and
// the rollback refuses once a package was bought. Then the review fixes: a
// package payment, refund or chargeback writes no post row (a post saved under
// rules that have since changed stops none of them), nor does the sweep, which
// goes on when one post cannot move, finds a waiting post however long ago its
// slot ended and tries the owner's next Individual slot; neither the sweep nor
// a refund waits for a lock another transaction holds.
//
//   node --import tsx scripts/test-foundation-slot-packages.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow or sends email.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  assertReadOnlyPreflight,
  createChecks,
  executeGrants,
  sqlHelpers,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";
import { psqlSessions } from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261114154823_slot_packages.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");
const I30 = { id: "d6ca48e5-43be-40df-8d8c-72c98a6fda96", days: 30, cents: 6900 };
const K30 = { id: "5b0f4c1e-2a7d-4c43-9b51-7e0d3f6a9c11", days: 30, cents: 10000 };
const K90 = { id: "8c3e1a52-6f0b-4d29-a7c4-2b9e5d1f7a33", days: 90, cents: 30000 };
const K180 = { id: "e1d7b6a4-0c95-4f8e-b3a2-6d4c8f2e1b55", days: 180, cents: 60000 };
const sha = (text) => createHash("sha256").update(text).digest("hex");
const fingerprintOf = (label) =>
  `${createHash("sha256").update(`person-${label}`).digest("base64url").slice(0, 42)}A`;

const { check, current, passed: checks } = createChecks();

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { step } = applyStepsBefore(database, UPDATE);

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
  const scalar = (sql) => q(sql);
  const truth = (sql) => scalar(`select (${sql});`) === "t";
  const same = (a, b) => truth(`'${a}'::timestamptz='${b}'::timestamptz`);
  // A separate psql session, for the concurrency check.
  const { session, sessionAfter: later } = psqlSessions(database);

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
    -- Days pass for one member: every date of their slots, activations, posts,
    -- search documents and finished payments moves back by p_by.
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
    end$$;
    create or replace function internal.current_verified_identity(p_owner uuid) returns text
      language sql set search_path to 'pg_catalog' as $fn$
      select f.identity_hmac from private.accepted_identity_facts f where f.owner_id=p_owner and f.revoked_at is null
        and exists(select 1 from private.current_account_access a where a.id=p_owner) $fn$;`);
  const user = (label) => json(`select vmtest.member('${label}');`);
  const staffUser = (label, role) => json(`select vmtest.staff('${label}','${role}');`);
  const admin = staffUser("package-admin", "admin");
  const admin2 = staffUser("package-admin2", "admin");
  const verified = (label) => {
    const m = user(label);
    q(`select vmtest.verified('${m.id}','${admin.id}','${fingerprintOf(label)}');`);
    return m;
  };
  q(`select vmtest.verified('${admin.id}','${admin2.id}','${fingerprintOf("package-admin")}');`);
  q(`select vmtest.verified('${admin2.id}','${admin.id}','${fingerprintOf("package-admin2")}');`);
  const post = (owner, kind = "listing", area = "market") =>
    q(`select vmtest.post('${owner.id}','${kind}','${area}');`);
  const travel = (owner, by) => q(`select vmtest.travel('${owner.id}','${by}'::interval);`);
  const onSale = (value) =>
    q(
      `update private.slot_package_sales set on_sale=${value},changed_at=now(),reason='Fixture: switched for the checks';`
    );

  const packageSql = (owner, plan, slots, expected = plan.cents * slots, consent = "true") =>
    member(
      owner,
      `select api.start_package_checkout('${plan.id}',${slots},${expected},${consent});`
    );
  const slotSql = (owner, plan, slots) =>
    member(
      owner,
      `select api.start_slot_checkout('${plan.id}',${slots},${plan.cents * slots},true);`
    );
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
  /** Ozow's notice, applied as the notice handler does. */
  const notice = (paymentId, { amount, label = "event", tx = `tx-${paymentId}` } = {}) => {
    const row = json(
      `select jsonb_build_object('ref',merchant_reference,'amount',amount_cents) from private.payments where id='${paymentId}';`
    );
    const event = {
      payload_sha256: sha(`${label}-${paymentId}`),
      merchant_reference: row.ref,
      provider_request_id: `req-${paymentId}`,
      provider_transaction_id: tx,
      status: "complete",
      amount_cents: amount ?? Number(row.amount),
      currency: "ZAR",
    };
    return json(service(`select api.apply_provider_event($e$${JSON.stringify(event)}$e$::jsonb);`));
  };
  const settle = (owner, paymentId) => {
    open(owner, paymentId);
    return notice(paymentId);
  };
  const buyPackage = (owner, plan, slots) => {
    const quoted = json(packageSql(owner, plan, slots));
    const settled = settle(owner, quoted.payment_id);
    assert.equal(settled.outcome, "completed", JSON.stringify(settled));
    assert.equal(settled.fulfillment_status, "fulfilled", JSON.stringify(settled));
    return quoted.payment_id;
  };
  const buySlot = (owner, plan = I30) => {
    const quoted = json(slotSql(owner, plan, 1));
    assert.equal(settle(owner, quoted.payment_id).outcome, "completed");
    return quoted.payment_id;
  };
  /** The grant of a one-line payment. */
  const grantOf = (paymentId) =>
    json(`select jsonb_build_object('id',e.id,'line',l.id,'starts',e.starts_at,'ends',e.ends_at,
        'capacity',e.slot_capacity,'activations',e.activations_per_period,'package',e.package_id,'status',e.status,
        'slot_count',l.slot_count,'amount',l.amount_cents)
      from private.payment_lines l left join private.entitlements e on e.payment_line_id=l.id
      where l.payment_id='${paymentId}' and l.line_number=1;`);
  const mine = (owner) => json(member(owner, "select api.get_my_slot_package();"));
  const activate = (owner, id) => json(member(owner, `select api.activate_post('${id}');`));
  const live = (owner, id) => {
    const activation = activate(owner, id);
    q(`update private.posts set status='live',published_at=now(),
         visible_until=(select f.funded_until from internal.post_funding('${id}') f) where id='${id}';
       select internal.write_post_projection('${id}');`);
    return activation.entitlement_id;
  };
  /** The post is deleted: its place is free again (its start still counts). */
  const release = (id) =>
    q(
      `update private.post_activations set released_at=now(),release_reason='deleted' where post_id='${id}' and released_at is null;`
    );
  const eligible = (id) =>
    truth(`exists(select 1 from private.public_eligible_posts where id='${id}')`);
  const docUntil = (id) =>
    scalar(`select visible_until from private.post_search_documents where post_id='${id}';`);
  const publiclyVisible = (id) =>
    truth(`select d.is_visible and d.visible_until>statement_timestamp() from private.post_search_documents d
      where d.post_id='${id}'`);
  const sweep = () => json(service("select api.run_slot_renewals(100);"));
  const lifecycle = () => json(service("select api.run_post_lifecycle(100);"));

  // ------------------------------------------------------------ before
  await check("before the update: the preflight reads 'not applied'", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^slot packages: update not applied \(apply before the website release that uses it is deployed\); on sale: no \(switch absent\); packages: none \(table absent\); package payments: 0$/
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
    fails(packageSql(user("before"), K30, 5), "42883");
  });
  await check(
    "the update refuses a drifted body, a drifted view and a drifted column, changing nothing",
    () => {
      const before = fingerprint();
      const original = q(
        "select pg_get_functiondef('internal.activate_post(uuid)'::regprocedure);"
      );
      q(`create or replace function internal.activate_post(p_post_id uuid) returns jsonb
         language sql set search_path to 'pg_catalog' as $f$ select '{}'::jsonb $f$;`);
      assert.match(
        fails(step.sql, "55000"),
        /activate_post\(uuid\) [0-9a-f]{32} is not a reviewed body/
      );
      assert.match(preflight()[1][1], /internal.activate_post\(uuid\) is neither/);
      q(`${original};`);
      const view = q("select pg_get_viewdef('private.public_eligible_posts'::regclass,true);");
      q(
        `create or replace view private.public_eligible_posts with (security_invoker=true) as ${view.replace("WHERE NOT (EXISTS", "WHERE 1 = 1 AND NOT (EXISTS")}`
      );
      assert.match(
        fails(step.sql, "55000"),
        /post funding view private.public_eligible_posts [0-9a-f]{32} is not the reviewed definition/
      );
      assert.match(preflight()[1][1], /private.public_eligible_posts is not the reviewed view/);
      q(
        `create or replace view private.public_eligible_posts with (security_invoker=true) as ${view}`
      );
      q("alter table private.payment_lines add column slot_count text;");
      assert.match(fails(step.sql, "55000"), /column drift: private.payment_lines.slot_count text/);
      q("alter table private.payment_lines drop column slot_count;");
      assert.equal(fingerprint(), before);
    }
  );

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
      /^slot packages: already applied; on sale: no; packages: 0; package payments: 0$/
    );
    applySteps(database, [{ label: "slot packages rollback", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before, "the rollback leaves the pre-update schema");
    assert.match(preflight()[0][1], /^slot packages: update not applied/);
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
  });

  await check(
    "the grants: members buy and read their own package; only the website's server reads the offer",
    () => {
      const grants = executeGrants(json, [
        "api.start_package_checkout(uuid,integer,bigint,boolean)",
        "api.get_my_slot_package()",
        "api.get_slot_package_offer()",
        "internal.slot_package_now(uuid)",
        "internal.slot_chain_paid_end(uuid)",
        "internal.refresh_package_documents(uuid)",
      ]);
      assert.deepEqual(grants["api.start_package_checkout(uuid,integer,bigint,boolean)"], {
        anon: false,
        authenticated: true,
        service_role: false,
      });
      assert.deepEqual(grants["api.get_my_slot_package()"], {
        anon: false,
        authenticated: true,
        service_role: false,
      });
      assert.deepEqual(grants["api.get_slot_package_offer()"], {
        anon: false,
        authenticated: false,
        service_role: true,
      });
      for (const helper of [
        "internal.slot_package_now(uuid)",
        "internal.slot_chain_paid_end(uuid)",
        "internal.refresh_package_documents(uuid)",
      ])
        assert.deepEqual(grants[helper], {
          anon: false,
          authenticated: false,
          service_role: false,
        });
      // No API role reads or writes the new tables.
      for (const table of ["private.slot_packages", "private.slot_package_sales"])
        for (const role of ["anon", "authenticated", "service_role"])
          assert.equal(
            truth(`has_table_privilege('${role}','${table}','select,insert,update,delete')`),
            false
          );
      assert.equal(
        truth(
          "(select relrowsecurity from pg_class where oid='private.slot_packages'::regclass) and (select relrowsecurity from pg_class where oid='private.slot_package_sales'::regclass)"
        ),
        true
      );
    }
  );

  // ------------------------------------------------------- the switch
  await check("sales off: nothing can be bought and the offer lists no terms", () => {
    const offer = json(service("select api.get_slot_package_offer();"));
    assert.equal(offer.on_sale, false);
    assert.deepEqual(offer.plans, []);
    fails(asRole("anon", "select api.get_slot_package_offer();"), "42501");
    fails(member(user("offer-reader"), "select api.get_slot_package_offer();"), "42501");
    assert.equal(offer.min_slots, 5);
    assert.equal(offer.max_online_slots, 100);
    const thandi = verified("thandi-off");
    fails(packageSql(thandi, K30, 5), "PT403", /packages_not_on_sale/);
    assert.equal(count(`private.payments where owner_id='${thandi.id}'`), 0);
    assert.equal(mine(thandi).can_buy, false);
    // The slot catalogue and the Individual checkout never offer package terms.
    const catalogue = json("select api.billing_catalogue();");
    assert.equal(
      catalogue.plans.some((p) => p.code.startsWith("slot_package")),
      false
    );
    onSale(true);
    fails(slotSql(thandi, K30, 1), "22023", /this slot is not on sale/);
    onSale(false);
  });

  onSale(true);
  await check("the offer while on sale: three terms at R100 per slot per 30 days", () => {
    const offer = json(service("select api.get_slot_package_offer();"));
    assert.equal(offer.on_sale, true);
    assert.deepEqual(
      offer.plans.map((p) => [p.id, p.term_days, p.price_cents_per_slot]),
      [
        [K30.id, 30, "10000"],
        [K90.id, 90, "30000"],
        [K180.id, 180, "60000"],
      ]
    );
  });

  // ------------------------------------------------- typed number, limits
  await check("the typed number of slots and the R10,000 online limit for each term", () => {
    const sipho = verified("sipho-bounds");
    fails(packageSql(sipho, K30, 4), "22023", /package_slots_invalid/);
    fails(packageSql(sipho, K30, 0), "22023", /package_slots_invalid/);
    fails(packageSql(sipho, K30, 251), "22023", /package_slots_invalid/);
    fails(packageSql(sipho, K30, 101), "PT413", /package_invoice_required/);
    fails(packageSql(sipho, K90, 34), "PT413", /package_invoice_required/);
    fails(packageSql(sipho, K180, 17), "PT413", /package_invoice_required/);
    const quote = (plan, slots) => json(packageSql(sipho, plan, slots));
    for (const [plan, slots, cents] of [
      [K30, 5, "50000"],
      [K30, 100, "1000000"],
      [K90, 33, "990000"],
      [K180, 16, "960000"],
    ]) {
      const quoted = quote(plan, slots);
      assert.deepEqual([quoted.amount_cents, quoted.slots, quoted.package], [cents, slots, true]);
    }
    // Each new order replaced the one before it (never sent to Ozow).
    assert.equal(count(`private.payments where owner_id='${sipho.id}' and status='pending'`), 1);
    assert.equal(count(`private.payments where owner_id='${sipho.id}' and status='cancelled'`), 3);
    // The shown total and the consent.
    fails(packageSql(sipho, K30, 5, 49900), "PT428");
    fails(packageSql(sipho, K30, 5, 50000, "false"), "22023", /cooling-off consent/);
    fails(packageSql(sipho, K30, 5, 50000, "null"), "22023", /cooling-off consent/);
    fails(packageSql(sipho, I30, 5, 34500), "22023", /package term is not on sale/);
  });

  await check("an accepted ID review is needed", () => {
    const unverified = user("lindiwe-unverified");
    fails(packageSql(unverified, K30, 5), "PT412");
    assert.equal(count(`private.payments where owner_id='${unverified.id}'`), 0);
    assert.equal(mine(unverified).can_buy, false);
    assert.equal(mine(unverified).verified, false);
  });

  // -------------------------------------------------------- buying one
  await check(
    "a paid package: one payment, one line, one package that ends exactly its term later",
    () => {
      const zola = verified("zola");
      assert.equal(mine(zola).package, null);
      assert.equal(mine(zola).can_buy, true);
      const quoted = json(packageSql(zola, K90, 25));
      assert.equal(quoted.amount_cents, "750000");
      const snap = json(`select snapshot from private.payments where id='${quoted.payment_id}';`);
      assert.equal(snap.category, "slot_package");
      assert.equal(snap.slots, 25);
      assert.equal(snap.slot_capacity, 25);
      assert.equal(snap.activations_per_period, 100);
      assert.equal(snap.invoice_description, "Multi-listing package: 25 slots × 90 days");
      assert.equal(snap.cooling_off_consent.wording_version, "package-starts-now-v1");
      assert.match(
        snap.cooling_off_consent.wording,
        /^My slots start now; the 7-day cooling-off does not apply/
      );
      // The same order again continues the open one.
      assert.equal(json(packageSql(zola, K90, 25)).payment_id, quoted.payment_id);
      const settled = settle(zola, quoted.payment_id);
      assert.equal(settled.outcome, "completed");
      const grant = grantOf(quoted.payment_id);
      assert.deepEqual(
        [grant.capacity, grant.activations, grant.slot_count, grant.amount, grant.status],
        [25, 100, 25, 750000, "active"]
      );
      assert.ok(grant.package);
      assert.ok(
        truth(
          `'${grant.starts}'::timestamptz=(select completed_at from private.payments where id='${quoted.payment_id}')`
        ),
        "starts at payment"
      );
      assert.ok(
        truth(`'${grant.ends}'::timestamptz='${grant.starts}'::timestamptz+interval '90 days'`)
      );
      assert.equal(count(`private.payment_lines where payment_id='${quoted.payment_id}'`), 1);
      assert.equal(count(`private.slot_packages where owner_id='${zola.id}'`), 1);
      const row = json(
        `select jsonb_build_object('term',term_days,'slots',slot_count) from private.slot_packages where id='${grant.package}';`
      );
      assert.deepEqual(row, { term: 90, slots: 25 });
      const view = mine(zola);
      assert.equal(view.can_buy, false);
      assert.equal(view.package.id, grant.package);
      assert.deepEqual(
        [
          view.package.state,
          view.package.places,
          view.package.term_days,
          view.package.new_posts_limit,
        ],
        ["active", 25, 90, 100]
      );
      assert.ok(same(view.package.ends_at, grant.ends));
      // My slots shows its grant as the package, not as a slot.
      assert.deepEqual(view.package.grants, [grant.id]);
      // A package never changes; the Individual slot count ignores it.
      fails(`update private.slot_packages set slot_count=30 where id='${grant.package}';`, "23514");
      assert.equal(json(member(zola, "select api.get_my_slots_v2();")).individual.held, 0);
      // A second package is refused while it runs.
      fails(packageSql(zola, K30, 5), "PT409", /package_active/);
    }
  );

  await check("an Ozow notice replayed or with another amount changes nothing", () => {
    const nandi = verified("nandi");
    const quoted = json(packageSql(nandi, K30, 10));
    open(nandi, quoted.payment_id);
    const wrong = notice(quoted.payment_id, { amount: 90000, label: "short" });
    assert.equal(wrong.outcome, "amount_mismatch");
    assert.equal(count(`private.slot_packages where owner_id='${nandi.id}'`), 0);
    assert.equal(
      scalar(`select status from private.payments where id='${quoted.payment_id}';`),
      "pending"
    );
    assert.equal(notice(quoted.payment_id).outcome, "completed");
    assert.equal(notice(quoted.payment_id).outcome, "duplicate_event");
    assert.equal(notice(quoted.payment_id, { label: "again" }).outcome, "already_complete");
    assert.equal(count(`private.slot_packages where owner_id='${nandi.id}'`), 1);
    assert.equal(count(`private.entitlements where owner_id='${nandi.id}'`), 1);
  });

  await check(
    "one package per account: a late second payment goes to reconciliation and staff cannot activate it",
    () => {
      const bheki = verified("bheki");
      const first = json(packageSql(bheki, K30, 5));
      open(bheki, first.payment_id);
      // Its Ozow page expired; the member then buys another package.
      q(
        `update private.payments set status='expired',status_changed_at=now() where id='${first.payment_id}';`
      );
      buyPackage(bheki, K90, 6);
      // The first payment arrives late: kept, not delivered.
      const late = notice(first.payment_id);
      assert.deepEqual(
        [late.outcome, late.fulfillment_status],
        ["complete_unfulfillable_target", "needs_reconciliation"]
      );
      assert.equal(count(`private.slot_packages where owner_id='${bheki.id}'`), 1);
      fails(
        staff(
          admin,
          `select api.activate_staff_paid_payment('${first.payment_id}','Deliver the late package payment');`
        ),
        "PT409",
        /package_active/
      );
    }
  );

  // ------------------------------------------------- posts in the places
  await check("posts use the package's places, at most the number of slots", () => {
    const ayanda = verified("ayanda");
    const paymentId = buyPackage(ayanda, K30, 5);
    const grant = grantOf(paymentId);
    const posts = Array.from({ length: 5 }, () => post(ayanda));
    for (const id of posts) assert.equal(live(ayanda, id), grant.id);
    assert.equal(mine(ayanda).package.posts.length, 5);
    const sixth = post(ayanda);
    fails(
      member(ayanda, `select api.activate_post('${sixth}');`),
      "PT409",
      /all posting capacity is in use/
    );
    for (const id of posts) assert.ok(eligible(id));
    // The capacity and allowance reads count the package's places.
    const capacity = json(member(ayanda, "select api.my_posting_capacity();"));
    assert.deepEqual([capacity.capacity, capacity.active], [5, 5]);
    // Another member's post never uses it.
    const other = verified("ayanda-other");
    fails(member(other, `select api.activate_post('${post(other)}');`), "PT402");
    assert.equal(mine(other).package, null);
  });

  await check("two activations racing for the last place: exactly one wins", async () => {
    const bongani = verified("bongani");
    buyPackage(bongani, K30, 5);
    for (let i = 0; i < 4; i += 1) live(bongani, post(bongani));
    const [a, b] = [post(bongani), post(bongani)];
    const [first, second] = await Promise.all([
      session(
        member(bongani, `begin; select api.activate_post('${a}'); select pg_sleep(1.5); commit;`)
      ),
      later(400, member(bongani, `select api.activate_post('${b}');`)),
    ]);
    assert.equal(first.status, 0, first.stderr);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /ERROR:\s+PT409:/);
    assert.equal(
      count(
        `private.post_activations a join private.entitlements e on e.id=a.entitlement_id where e.owner_id='${bongani.id}' and e.package_id is not null and a.released_at is null`
      ),
      5
    );
  });

  await check("the 4 posts going live per slot per 30 days count over the whole package", () => {
    const lerato = verified("lerato");
    buyPackage(lerato, K30, 5);
    for (let i = 0; i < 20; i += 1) {
      const id = post(lerato);
      activate(lerato, id);
      release(id);
    }
    assert.equal(mine(lerato).package.new_posts_started, 20);
    fails(
      member(lerato, `select api.activate_post('${post(lerato)}');`),
      "PT409",
      /all posting capacity is in use/
    );
  });

  // ---------------------------------------------------------------- E3
  await check(
    "E3: while a package runs no Individual slot is bought or renewed; in its last 7 days it can be",
    () => {
      const mpho = verified("mpho");
      const slot = buySlot(mpho);
      buyPackage(mpho, K30, 5);
      fails(slotSql(mpho, I30, 1), "PT409", /package_active/);
      const slotGrant = grantOf(slot);
      travel(mpho, "17 days");
      // The Individual slot is in its renewal window, but renewing is closed.
      fails(
        member(
          mpho,
          `select api.start_slot_renewal_checkout(array['${slotGrant.id}']::uuid[],'${I30.id}',6900,true);`
        ),
        "PT409",
        /package_active/
      );
      assert.ok(mine(mpho).individual_blocked_until);
      // The package's last 7 days: Individual slots can be bought and renewed again.
      travel(mpho, "6 days 1 hour");
      assert.equal(mine(mpho).individual_blocked_until, null);
      assert.equal(json(slotSql(mpho, I30, 1)).slots, 1);
    }
  );

  await check(
    "E3: when an Individual slot ends, the package takes its post at once, and the sweep moves it in without counting it as new",
    () => {
      const kagiso = verified("kagiso");
      const slot = buySlot(kagiso);
      const slotGrant = grantOf(slot);
      const listing = post(kagiso);
      assert.equal(live(kagiso, listing), slotGrant.id);
      const paymentId = buyPackage(kagiso, K90, 5);
      const pkg = grantOf(paymentId);
      // New posts go into the package first, not the Individual slot ending soon.
      const fresh = post(kagiso);
      assert.equal(live(kagiso, fresh), pkg.id);
      // Delivery leaves the Individual post's search document alone: the
      // package takes the post only when its slot ends.
      assert.ok(same(docUntil(listing), slotGrant.ends));
      // The minute sweep before the slot's end moves the document to the
      // package's end, because the package will take the post.
      travel(kagiso, "29 days 23 hours 59 minutes");
      sweep();
      assert.ok(same(docUntil(listing), grantOf(paymentId).ends));
      // The Individual slot ends a second ago; no job has run since.
      travel(kagiso, "1 minute 1 second");
      const pkgNow = grantOf(paymentId);
      assert.ok(eligible(listing), "public view");
      assert.ok(
        truth(`exists(select 1 from private.frontend_restorable_posts where id='${listing}')`),
        "restorable"
      );
      assert.ok(publiclyVisible(listing), "search document");
      assert.equal(
        json(asRole("anon", `select api.get_public_post('${listing}');`)).id,
        listing,
        "post page"
      );
      assert.ok(
        truth(
          `(select funded_until from internal.post_funding('${listing}'))='${pkgNow.ends}'::timestamptz`
        ),
        "funding"
      );
      let view = mine(kagiso);
      assert.deepEqual(
        view.package.posts.map((p) => [p.id, p.moving]),
        [
          [fresh, false],
          [listing, true],
        ]
      );
      // It fills a place before it moves.
      assert.equal(json(member(kagiso, "select api.my_posting_capacity();")).active, 2);
      const startedBefore = view.package.new_posts_started;
      // The sweep moves it in: the old activation released, the new one continued.
      const result = sweep();
      assert.equal(result.package_moved, 1);
      assert.equal(
        json(`select jsonb_build_object('reason',release_reason) from private.post_activations
          where post_id='${listing}' and entitlement_id='${slotGrant.id}';`).reason,
        "entitlement_ended"
      );
      assert.equal(
        scalar(
          `select continued from private.post_activations where post_id='${listing}' and released_at is null;`
        ),
        "t"
      );
      view = mine(kagiso);
      assert.equal(
        view.package.new_posts_started,
        startedBefore,
        "a moved post is not a post going live"
      );
      assert.deepEqual(
        view.package.posts.map((p) => p.moving),
        [false, false]
      );
      assert.ok(eligible(listing));
      // The lifecycle job brings the post's own end date up to the package's.
      lifecycle();
      assert.equal(scalar(`select status from private.posts where id='${listing}';`), "live");
      assert.ok(
        same(scalar(`select visible_until from private.posts where id='${listing}';`), pkgNow.ends)
      );
      assert.equal(sweep().package_moved, 0, "moved once");
    }
  );

  await check("E3: a full package does not take the post; it follows the 3-day grace", () => {
    const naledi = verified("naledi");
    const slot = buySlot(naledi);
    const listing = post(naledi);
    assert.equal(live(naledi, listing), grantOf(slot).id);
    buyPackage(naledi, K90, 5);
    for (let i = 0; i < 5; i += 1) live(naledi, post(naledi));
    const ownEnd = docUntil(listing);
    // Its document keeps its own end: the package will not take it.
    sweep();
    assert.ok(same(docUntil(listing), ownEnd));
    travel(naledi, "30 days 1 second");
    assert.equal(eligible(listing), false);
    assert.equal(
      mine(naledi).package.posts.some((p) => p.id === listing),
      false
    );
    assert.equal(sweep().package_moved, 0);
    lifecycle();
    assert.equal(scalar(`select status from private.posts where id='${listing}';`), "expired");
    assert.ok(truth(`(select deletes_at from private.posts where id='${listing}')>now()`));
  });

  // ------------------------------------------------------ another account
  await check(
    "another account cannot see or use the package; no team member joins its grant",
    () => {
      const owner = verified("owner-private");
      const paymentId = buyPackage(owner, K30, 5);
      const grant = grantOf(paymentId);
      const stranger = verified("stranger");
      assert.equal(mine(stranger).package, null);
      fails(member(stranger, `select api.activate_post('${post(stranger)}');`), "PT402");
      q(
        `update auth.users set email='member-${stranger.id}@example.invalid' where id='${stranger.id}';`
      );
      fails(
        member(
          owner,
          `select api.manage_plan_member('${grant.id}','add','member-${stranger.id}@example.invalid');`
        ),
        "42501"
      );
      fails(
        member(
          stranger,
          `select api.manage_plan_member('${grant.id}','add','member-${stranger.id}@example.invalid');`
        ),
        "42501"
      );
      assert.equal(count(`private.entitlement_members where entitlement_id='${grant.id}'`), 0);
      fails(asRole("anon", "select api.get_my_slot_package();"), "42501");
    }
  );

  // ------------------------------------------ commission, refund, chargeback
  await check(
    "partner commission is 20% of the package once; a refund reverses it and withdraws the package and its posts",
    () => {
      const partner = user("partner");
      const buyer = verified("referred-buyer");
      q(`select set_config('session_replication_role','replica',false);
      insert into private.partners(account_id,code,status,commission_bps,created_by)
        values('${partner.id}','PACKAGE7','active',2000,'${admin.id}');
      insert into private.account_acquisitions(account_id,source,partner_id)
        values('${buyer.id}','partner',(select id from private.partners where account_id='${partner.id}'));
      select set_config('session_replication_role','origin',false);`);
      const paymentId = buyPackage(buyer, K30, 5);
      const grant = grantOf(paymentId);
      const commissions = () =>
        json(`select coalesce(jsonb_agg(jsonb_build_object('line',payment_line_id,'base',base_cents,
          'amount',amount_cents,'status',status)),'[]') from private.partner_commissions where payment_id='${paymentId}';`);
      assert.deepEqual(commissions(), [
        { line: grant.line, base: 50000, amount: 10000, status: "pending" },
      ]);
      const listing = post(buyer);
      assert.equal(live(buyer, listing), grant.id);
      const result = json(
        staff(
          admin,
          `select api.record_staff_slot_refund('${grant.line}','refunded','billing_error','Charged in error for the package','OZ-PACKAGE-1');`
        )
      );
      assert.equal(result.status, "applied", JSON.stringify(result));
      assert.equal(grantOf(paymentId).status, "revoked");
      assert.deepEqual(
        commissions().map((c) => c.status),
        ["reversed"]
      );
      assert.equal(scalar(`select status from private.posts where id='${listing}';`), "expired");
      assert.equal(eligible(listing), false);
      assert.equal(mine(buyer).package, null);
      assert.equal(mine(buyer).can_buy, true);
    }
  );

  await check("a chargeback withdraws the package and its posts", () => {
    const vusi = verified("vusi");
    const paymentId = buyPackage(vusi, K30, 5);
    const grant = grantOf(paymentId);
    const listing = post(vusi);
    live(vusi, listing);
    q(
      `select internal.reverse_payment_line('${grant.line}','chargeback','Bank chargeback on the package','${admin.id}');`
    );
    assert.equal(grantOf(paymentId).status, "revoked");
    assert.equal(
      scalar(`select status from private.payments where id='${paymentId}';`),
      "chargeback"
    );
    assert.equal(eligible(listing), false);
    assert.equal(json(member(vusi, "select api.my_posting_capacity();")).capacity, 0);
  });

  // ------------------------------------------------------ Individual intact
  await check("without a package, Individual slots work as before", () => {
    const thembi = verified("thembi");
    const slot = buySlot(thembi);
    const listing = post(thembi);
    assert.equal(live(thembi, listing), grantOf(slot).id);
    assert.equal(json(member(thembi, "select api.get_my_slots_v2();")).individual.held, 1);
    assert.equal(mine(thembi).individual_blocked_until, null);
    travel(thembi, "30 days 1 second");
    assert.equal(eligible(listing), false, "no package: the post is not taken");
  });

  // ------------------------------------------------------------ review fixes
  const emailOf = (owner) => scalar(`select email from auth.users where id='${owner.id}';`);
  await check(
    "E3 at delivery: an Individual slot or renewal paid after a package started is not delivered",
    () => {
      const sizwe = verified("sizwe");
      const kept = buySlot(sizwe);
      // A new slot and a renewal left open at Ozow, then a package.
      const quotedSlot = json(slotSql(sizwe, I30, 1));
      open(sizwe, quotedSlot.payment_id);
      travel(sizwe, "17 days");
      const renewal = json(
        member(
          sizwe,
          `select api.start_slot_renewal_checkout(array['${grantOf(kept).id}']::uuid[],'6a449457-2384-457e-9434-23c2b0e73127',20700,true);`
        )
      );
      open(sizwe, renewal.payment_id);
      buyPackage(sizwe, K90, 5);
      for (const paymentId of [quotedSlot.payment_id, renewal.payment_id]) {
        const paid = notice(paymentId);
        assert.deepEqual(
          [paid.outcome, paid.fulfillment_status],
          ["complete_unfulfillable_target", "needs_reconciliation"]
        );
        assert.equal(count(`private.entitlements where payment_id='${paymentId}'`), 0);
        assert.equal(
          count(
            `private.outbox_events where kind='payment_reconciliation_required' and subject_id='${paymentId}'`
          ),
          1
        );
        fails(
          staff(
            admin,
            `select api.activate_staff_paid_payment('${paymentId}','Deliver the slot paid late');`
          ),
          "PT409",
          /package_active/
        );
      }
      assert.equal(json(member(sizwe, "select api.get_my_slots_v2();")).individual.held, 1);
    }
  );

  await check(
    "E3 on invoices: no Individual invoice is issued, paid, recorded or confirmed while a package runs",
    () => {
      const lwazi = verified("lwazi");
      // Issued and recorded before the package.
      const invoice = json(
        staff(
          admin,
          `select api.issue_staff_invoice('${emailOf(lwazi)}',30,2,7,'Invoice requested by email',gen_random_uuid());`
        )
      );
      const today = q(
        "select to_char((now() at time zone 'Africa/Johannesburg')::date,'YYYY-MM-DD');"
      );
      const transfer = json(
        staff(
          admin,
          `select api.record_staff_invoice_payment('${emailOf(lwazi)}',30,1,6900,'EFT LWAZI 01','${today}',true,'EFT cleared; customer agreed in writing');`
        )
      );
      q(
        member(
          lwazi,
          `select api.save_my_invoice_billing('${invoice.invoice_number}',1,'Fixture Traders (Pty) Ltd','1 Example Road\nEmpangeni\n3880','2020/123456/07');`
        )
      );
      buyPackage(lwazi, K90, 5);
      fails(
        staff(
          admin,
          `select api.issue_staff_invoice('${emailOf(lwazi)}',30,1,7,'Invoice requested by email',gen_random_uuid());`
        ),
        "PT409",
        /package_active/
      );
      fails(
        member(lwazi, `select api.start_invoice_payment('${invoice.invoice_number}',13800,true);`),
        "PT409",
        /package_active/
      );
      fails(
        staff(
          admin,
          `select api.record_staff_invoice_payment('${emailOf(lwazi)}',30,1,6900,'EFT LWAZI 02','${today}',true,'EFT cleared; customer agreed in writing');`
        ),
        "PT409",
        /package_active/
      );
      fails(
        staff(
          admin,
          `select api.record_staff_invoice_transfer('${invoice.invoice_number}','EFT LWAZI 03','${today}',true,'EFT cleared; written waiver on file');`
        ),
        "PT409",
        /package_active/
      );
      fails(
        staff(admin2, `select api.confirm_staff_invoice_payment('${transfer.transfer_id}');`),
        "PT409",
        /package_active/
      );
      assert.equal(json(member(lwazi, "select api.get_my_slots_v2();")).individual.held, 0);
    }
  );

  await check(
    "a package reaches Ozow and is delivered only while on sale and with an accepted ID review",
    () => {
      const mandla = verified("mandla");
      const first = json(packageSql(mandla, K30, 5));
      onSale(false);
      fails(
        service(`select api.claim_checkout_request('${first.payment_id}','${mandla.id}');`),
        "PT403",
        /packages_not_on_sale/
      );
      onSale(true);
      open(mandla, first.payment_id);
      onSale(false);
      const paid = notice(first.payment_id);
      assert.deepEqual(
        [paid.outcome, paid.fulfillment_status],
        ["complete_unfulfillable_target", "needs_reconciliation"]
      );
      assert.equal(count(`private.slot_packages where owner_id='${mandla.id}'`), 0);
      fails(
        staff(
          admin,
          `select api.activate_staff_paid_payment('${first.payment_id}','Deliver the package paid late');`
        ),
        "PT403",
        /packages_not_on_sale/
      );
      onSale(true);
      // The ID review revoked while the Ozow page is open.
      const thabo = verified("thabo");
      const second = json(packageSql(thabo, K30, 5));
      open(thabo, second.payment_id);
      q(
        `update private.accepted_identity_facts set revoked_at=now() where owner_id='${thabo.id}';`
      );
      fails(
        service(`select api.claim_checkout_request('${second.payment_id}','${thabo.id}');`),
        "PT412"
      );
      assert.equal(notice(second.payment_id).fulfillment_status, "needs_reconciliation");
      assert.equal(count(`private.slot_packages where owner_id='${thabo.id}'`), 0);
    }
  );

  await check("a refunded package gives back the post it took: it expires on its real date", () => {
    const ntombi = verified("ntombi");
    const slot = buySlot(ntombi);
    const listing = post(ntombi);
    live(ntombi, listing);
    const paymentId = buyPackage(ntombi, K90, 5);
    travel(ntombi, "30 days 1 second");
    assert.ok(eligible(listing));
    // The lifecycle job catches its end date up to the package's (it is taken).
    lifecycle();
    assert.ok(
      same(
        scalar(`select visible_until from private.posts where id='${listing}';`),
        grantOf(paymentId).ends
      )
    );
    // Refunded before the sweep moved it in: its search document goes back at
    // once; the refund writes no post row (the lifecycle job ends the post).
    q(
      `select internal.reverse_payment_line('${grantOf(paymentId).line}','refunded','Billing error on the package','${admin.id}');`
    );
    const own = scalar(`select ends_at from private.entitlements where id='${grantOf(slot).id}';`);
    assert.ok(same(docUntil(listing), own));
    assert.ok(
      same(
        scalar(`select visible_until from private.posts where id='${listing}';`),
        grantOf(paymentId).ends
      )
    );
    assert.equal(eligible(listing), false);
    lifecycle();
    assert.equal(scalar(`select status from private.posts where id='${listing}';`), "expired");
    assert.ok(
      truth(
        `(select deletes_at from private.posts where id='${listing}')<=now()+interval '3 days 1 minute'`
      )
    );
  });

  await check(
    "going below 5: in a package's last 7 days new posts and its posts move into Individual slots",
    () => {
      const zanele = verified("zanele");
      const paymentId = buyPackage(zanele, K30, 5);
      const pkg = grantOf(paymentId);
      const posts = [post(zanele), post(zanele), post(zanele)];
      for (const [i, id] of posts.entries()) {
        live(zanele, id);
        q(
          `update private.posts set published_at=now()-interval '${10 - i} hours' where id='${id}';`
        );
      }
      travel(zanele, "24 days");
      // Individual slots can be bought again; a new post goes into one.
      const two = buySlot(zanele);
      const extraSlot = buySlot(zanele);
      const fresh = post(zanele);
      assert.notEqual(live(zanele, fresh), pkg.id);
      // The sweep moves the most recently approved package post into the free place.
      const result = sweep();
      assert.equal(result.package_downsized, 1);
      const moved = posts[2];
      const where = (id) =>
        scalar(`select e.package_id is null from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
        where a.post_id='${id}' and a.released_at is null;`);
      assert.equal(where(moved), "t");
      assert.equal(where(posts[0]), "f");
      assert.equal(
        scalar(
          `select continued from private.post_activations where post_id='${moved}' and released_at is null;`
        ),
        "t"
      );
      assert.equal(sweep().package_downsized, 0, "no free place left");
      // At the package's end the moved post stays; the others follow the grace.
      travel(zanele, "6 days 1 hour");
      assert.ok(eligible(moved));
      assert.ok(eligible(fresh));
      assert.equal(eligible(posts[0]), false);
      lifecycle();
      assert.equal(scalar(`select status from private.posts where id='${moved}';`), "live");
      assert.equal(scalar(`select status from private.posts where id='${posts[0]}';`), "expired");
      assert.ok([two, extraSlot].every((p) => grantOf(p).status === "active"));
    }
  );

  // ------------------------------------------------------- second review
  /** A post saved under rules that have since changed: any write of its row
   * now fails when the transaction commits (the deferred attribute check). */
  const breakRules = (id) => {
    q(`set session_replication_role=replica;
      update private.listing_details set attributes='{"retired_field":"x"}'::jsonb where post_id='${id}';`);
    fails(
      `update private.posts set visible_until=visible_until where id='${id}';`,
      "22023",
      /unknown attribute key/
    );
  };
  const mendRules = (id) =>
    q(`set session_replication_role=replica;
      update private.listing_details set attributes='{}'::jsonb where post_id='${id}';`);
  /** The grant the post is in now. */
  const heldIn = (id) =>
    scalar(
      `select entitlement_id from private.post_activations where post_id='${id}' and released_at is null;`
    );
  const inPackage = (id) =>
    truth(`exists(select 1 from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
      where a.post_id='${id}' and a.released_at is null and e.package_id is not null)`);
  const postUntil = (id) => scalar(`select visible_until from private.posts where id='${id}';`);

  await check(
    "no post check can stop a package payment, refund or chargeback: they write no post row",
    () => {
      const ayo = verified("ayo");
      const slots = [buySlot(ayo), buySlot(ayo)];
      const listings = [post(ayo), post(ayo)];
      for (const id of listings) live(ayo, id);
      const first = buyPackage(ayo, K90, 5);
      // Both slots end; the package takes both posts and the lifecycle job
      // brings their own end dates up to the package's.
      travel(ayo, "30 days 1 second");
      lifecycle();
      assert.ok(same(postUntil(listings[0]), grantOf(first).ends));
      // One of them was saved under rules that have since changed.
      breakRules(listings[0]);
      try {
        // A refund: its search documents go back; no post row is written.
        q(
          `select internal.reverse_payment_line('${grantOf(first).line}','refunded','Billing error on the package','${admin.id}');`
        );
        assert.equal(grantOf(first).status, "revoked");
        for (const [i, id] of listings.entries()) {
          assert.ok(same(docUntil(id), grantOf(slots[i]).ends));
          assert.ok(same(postUntil(id), grantOf(first).ends), "left to the lifecycle job");
        }
        // An Ozow settle of a new package (fulfilled), then its chargeback.
        const second = buyPackage(ayo, K30, 5);
        assert.equal(grantOf(second).status, "active");
        q(
          `select internal.reverse_payment_line('${grantOf(second).line}','chargeback','Bank chargeback on the package','${admin.id}');`
        );
        assert.equal(
          scalar(`select status from private.payments where id='${second}';`),
          "chargeback"
        );
        assert.ok(same(postUntil(listings[0]), grantOf(first).ends));
      } finally {
        mendRules(listings[0]);
      }
      // The lifecycle job ends both on their real dates.
      lifecycle();
      for (const id of listings)
        assert.equal(scalar(`select status from private.posts where id='${id}';`), "expired");
    }
  );

  await check("the sweep writes no post row and goes on when one post cannot move", () => {
    const lungile = verified("lungile");
    for (let i = 0; i < 3; i += 1) buySlot(lungile);
    const listings = [post(lungile), post(lungile), post(lungile)];
    for (const id of listings) live(lungile, id);
    buyPackage(lungile, K90, 5);
    travel(lungile, "30 days 1 second");
    breakRules(listings[0]);
    // A fault on the second post's move (a stand-in for anything unexpected).
    q(`create function vmtest.refuse_move() returns trigger language plpgsql as $f$ begin
           if new.post_id='${listings[1]}' and new.continued then raise exception 'fixture: this move fails'; end if;
           return new; end $f$;
         create trigger vmtest_refuse_move before insert on private.post_activations
           for each row execute function vmtest.refuse_move();`);
    try {
      const result = sweep();
      assert.ok(result.package_skipped >= 1, JSON.stringify(result));
      assert.ok(inPackage(listings[0]), "a post failing current rules still moves");
      assert.equal(inPackage(listings[1]), false, "the failed move is undone");
      assert.ok(eligible(listings[1]), "it stays funded at read time");
      assert.ok(inPackage(listings[2]), "the post after it still moves");
    } finally {
      q(
        "drop trigger vmtest_refuse_move on private.post_activations; drop function vmtest.refuse_move();"
      );
      mendRules(listings[0]);
    }
    assert.equal(sweep().package_skipped, 0);
    assert.ok(inPackage(listings[1]), "the next run moves it");
  });

  await check("the sweep finds a waiting post whose slot ended more than 7 days ago", () => {
    const siyanda = verified("siyanda");
    buySlot(siyanda);
    const listing = post(siyanda);
    live(siyanda, listing);
    const paymentId = buyPackage(siyanda, K90, 5);
    // The slot ended 8 days ago and no sweep has run since.
    travel(siyanda, "38 days");
    assert.ok(eligible(listing), "the package takes it at read time");
    sweep();
    assert.equal(heldIn(listing), grantOf(paymentId).id);
    assert.ok(same(docUntil(listing), grantOf(paymentId).ends));
  });

  await check("going below 5: a post one slot cannot carry tries the owner's next slot", () => {
    const thuli = verified("thuli");
    buyPackage(thuli, K30, 5);
    const listing = post(thuli);
    live(thuli, listing);
    travel(thuli, "24 days");
    const slots = [buySlot(thuli), buySlot(thuli)].map((p) => grantOf(p).id);
    // The slot the sweep tries first is for another area: it cannot carry a
    // Market post.
    const first =
      scalar(`select f.entitlement_id from internal.individual_free_places('${thuli.id}') f
      order by f.runs_until desc, f.entitlement_id limit 1;`);
    q(`set session_replication_role=replica;
      update private.entitlements set area='business' where id='${first}';`);
    assert.ok(sweep().package_downsized >= 1);
    assert.notEqual(heldIn(listing), first);
    assert.ok(slots.includes(heldIn(listing)));
    assert.ok(eligible(listing));
  });

  await check("the sweep and a package refund never wait for a lock", async () => {
    // An activation holds a package's row: the sweep leaves it to the next run.
    const lindi = verified("lindi");
    buySlot(lindi);
    const waiting = post(lindi);
    live(lindi, waiting);
    const lindiPackage = buyPackage(lindi, K90, 5);
    travel(lindi, "30 days 1 second");
    const finished = {};
    const timed = (label, promise) =>
      promise.then((result) => {
        finished[label] = Date.now();
        return result;
      });
    const [holder, swept] = await Promise.all([
      timed(
        "holder",
        session(
          `begin; select 1 from private.slot_packages where id='${grantOf(lindiPackage).package}' for update; select pg_sleep(3); commit;`
        )
      ),
      timed("sweep", later(500, service("select api.run_slot_renewals(100);"))),
    ]);
    assert.equal(holder.status, 0, holder.stderr);
    assert.equal(swept.status, 0, swept.stderr);
    assert.ok(finished.sweep < finished.holder, "the sweep did not wait");
    assert.ok(JSON.parse(swept.stdout.trim()).package_skipped >= 1, swept.stdout);
    assert.equal(inPackage(waiting), false);
    sweep();
    assert.ok(inPackage(waiting), "the next run moves it");

    // A refund while another transaction holds the search document of a post
    // the package takes: the refund does not wait; the sweep corrects it.
    const mbali = verified("mbali");
    const slot = buySlot(mbali);
    const listing = post(mbali);
    live(mbali, listing);
    const paymentId = buyPackage(mbali, K90, 5);
    travel(mbali, "29 days 23 hours 59 minutes");
    sweep();
    travel(mbali, "1 minute 1 second");
    assert.ok(same(docUntil(listing), grantOf(paymentId).ends));
    const [docHolder, refund] = await Promise.all([
      timed(
        "docHolder",
        session(
          `begin; select 1 from private.post_search_documents where post_id='${listing}' for update; select pg_sleep(3); commit;`
        )
      ),
      timed(
        "refund",
        later(
          500,
          `select internal.reverse_payment_line('${grantOf(paymentId).line}','refunded','Billing error on the package','${admin.id}');`
        )
      ),
    ]);
    assert.equal(docHolder.status, 0, docHolder.stderr);
    assert.equal(refund.status, 0, refund.stderr);
    assert.ok(finished.refund < finished.docHolder, "the refund did not wait");
    assert.equal(grantOf(paymentId).status, "revoked");
    assert.ok(same(docUntil(listing), grantOf(paymentId).ends), "the busy document was skipped");
    const result = sweep();
    assert.ok(result.package_documents >= 1, JSON.stringify(result));
    assert.ok(same(docUntil(listing), grantOf(slot).ends));
    lifecycle();
    assert.equal(scalar(`select status from private.posts where id='${listing}';`), "expired");
  });

  await check(
    "retention removes a package with its last grant; the privacy export lists packages",
    () => {
      const olwethu = verified("olwethu");
      const paymentId = buyPackage(olwethu, K30, 5);
      const grant = grantOf(paymentId);
      const exported = json(`select internal.frontend_privacy_export_data('${olwethu.id}');`);
      assert.deepEqual(
        exported.slot_packages.map((p) => [p.id, p.term_days, p.slot_count]),
        [[grant.package, 30, 5]]
      );
      assert.equal(exported.entitlements.find((e) => e.id === grant.id).package_id, grant.package);
      assert.equal(exported.payments.find((p) => p.id === paymentId).lines[0].slot_count, 5);
      // Six years later its grant goes, and the package with it.
      q(`set session_replication_role=replica;
      update private.entitlements set starts_at=starts_at-interval '6 years',ends_at=ends_at-interval '6 years' where id='${grant.id}';
      update private.slot_packages set created_at=created_at-interval '6 years' where id='${grant.package}';
      set session_replication_role=origin;`);
      const removed = json("select internal.retention_commerce(500);");
      assert.ok(removed.slot_packages >= 1, JSON.stringify(removed));
      assert.equal(count(`private.slot_packages where id='${grant.package}'`), 0);
    }
  );

  await check("the post manager lists no package grant among plans with administrators", () => {
    const busi = verified("busi");
    buyPackage(busi, K30, 5);
    assert.deepEqual(
      json(member(busi, "select api.get_my_frontend_post_manager();")).plan_admins,
      []
    );
  });

  // --------------------------------------------------------------- rollback
  await check("the rollback refuses once a package was bought", () => {
    assert.match(
      preflight()[0][1],
      /^slot packages: already applied; on sale: YES; packages: [1-9][0-9]*; package payments: [1-9][0-9]*$/
    );
    assert.match(fails(ROLLBACK, "55000"), /a package exists/);
  });

  console.log(
    `\nAll ${checks.length} slot package checks passed in ${Math.round((Date.now() - started) / 1000)} s.`
  );
} finally {
  database.stop();
}
