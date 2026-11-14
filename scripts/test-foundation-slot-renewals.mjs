#!/usr/bin/env node
// Behaviour checks for 20261114093742_renew_slots_early.sql: renew early and
// renewal reminders (roadmap P3).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members renew with the production renewal checkout (as `authenticated`
// with synthetic claims and a live session row); the website's server leases,
// attaches and settles as `service_role` with synthetic Ozow request and
// transaction ids; staff act with a verified authenticator app and an AAL2
// session. Time is moved by shifting a member's own dates back (vmtest.travel),
// as if days had passed. The only stand-in is internal.current_verified_identity,
// which answers with the member's current accepted identity fact.
//
// It checks the read-only preflight and the update's refusals, applies the
// update, proves apply -> rollback -> apply returns the schema fingerprint to the
// same values, then the pass/fail list of P3 and the owner's renewal rule:
// renewing opens 14 days before a slot ends; an early renewal starts exactly at
// the old end, with one payment and the slot counted once; the post stays live
// across the boundary and moves into the next period; the 3-day grace starts
// only after the last renewal ends; renewing twice queues one after the other;
// "Renew all" for three slots with different ends makes one payment and each
// slot ends exactly its own period later; refunding one line (a renewal that
// has not started) withdraws only that slot and moves its post's end back; a
// chargeback of the current period keeps the queued renewal's dates; the
// R10,000 online limit applies to the total; a person over their limit renews
// at most the limit; no renewal before an accepted ID review or without the
// renewal's consent; another account cannot renew or see the slots; a late
// renewal starts at payment; staff can deliver a renewal sent to
// reconciliation; the reminder is queued once per slot end even when the job
// runs twice, links to "Renew all" when several slots end within 7 days, never
// goes to an unconfirmed address and is not sent for a slot renewed meanwhile;
// no payment is ever created by the job (no automatic charge); retention keeps
// a renewed slot's first period until its renewal is gone.
//
//   node --import tsx scripts/test-foundation-slot-renewals.mjs
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
  sqlHelpers,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261114093742_renew_slots_early.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");
const P30 = { id: "d6ca48e5-43be-40df-8d8c-72c98a6fda96", days: 30, cents: 6900 };
const P180 = { id: "ce4ef578-344a-4816-ab6a-6961bec46621", days: 180, cents: 41400 };
const sha = (text) => createHash("sha256").update(text).digest("hex");
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
  const scalar = (sql) => q(sql);

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
  const admin = staffUser("renew-admin", "admin");
  const admin2 = staffUser("renew-admin2", "admin");
  const verified = (label) => {
    const m = user(label);
    q(`select vmtest.verified('${m.id}','${admin.id}','${fingerprintOf(label)}');`);
    return m;
  };
  q(`select vmtest.verified('${admin.id}','${admin2.id}','${fingerprintOf("renew-admin")}');`);
  const post = (owner, kind = "listing", area = "market") =>
    q(`select vmtest.post('${owner.id}','${kind}','${area}');`);
  const travel = (owner, by) => q(`select vmtest.travel('${owner.id}','${by}'::interval);`);

  const quoteSql = (owner, plan, slots) =>
    member(
      owner,
      `select api.start_slot_checkout('${plan.id}',${slots},${plan.cents * slots},true);`
    );
  const ids = (list) => `array[${list.map((id) => `'${id}'`).join(",")}]::uuid[]`;
  const renewSql = (
    owner,
    entitlements,
    plan = P30,
    expected = plan.cents * entitlements.length,
    consent = "true"
  ) =>
    member(
      owner,
      `select api.start_slot_renewal_checkout(${ids(entitlements)},'${plan.id}',${expected},${consent});`
    );
  const renewQuote = (...args) => json(renewSql(...args));
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
  const confirm = (paymentId) => {
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
  const settle = (owner, paymentId) => {
    open(owner, paymentId);
    return confirm(paymentId);
  };
  const buy = (owner, plan, slots) => {
    const quoted = json(quoteSql(owner, plan, slots));
    const settled = settle(owner, quoted.payment_id);
    assert.equal(settled.outcome, "completed", JSON.stringify(settled));
    return quoted.payment_id;
  };
  const renew = (owner, entitlements, plan = P30) => {
    const quoted = renewQuote(owner, entitlements, plan);
    const settled = settle(owner, quoted.payment_id);
    assert.equal(settled.outcome, "completed", JSON.stringify(settled));
    return quoted.payment_id;
  };
  /** The grants of one payment, in line order. */
  const grantsOf = (paymentId) =>
    json(`select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'line',l.id,'starts',e.starts_at,'ends',e.ends_at,
        'slot',e.slot_id,'renews',e.renews_entitlement_id,'status',e.status,'line_renews',l.renews_entitlement_id)
        order by l.line_number),'[]')
      from private.payment_lines l left join private.entitlements e on e.payment_line_id=l.id
      where l.payment_id='${paymentId}';`);
  /** True when the SQL boolean is true. */
  const truth = (sql) => scalar(`select (${sql});`) === "t";
  /** Two instants are the same to the microsecond (any text form). */
  const same = (a, b) => truth(`'${a}'::timestamptz='${b}'::timestamptz`);
  const live = (owner, id) => {
    const activation = json(member(owner, `select api.activate_post('${id}');`));
    q(`update private.posts set status='live',published_at=now(),
         visible_until=(select f.funded_until from internal.post_funding('${id}') f) where id='${id}';
       select internal.write_post_projection('${id}');`);
    return activation.entitlement_id;
  };
  const visibleUntil = (id) => scalar(`select visible_until from private.posts where id='${id}';`);
  const publiclyVisible = (id) =>
    truth(`select d.is_visible and d.visible_until>statement_timestamp() from private.post_search_documents d
      where d.post_id='${id}'`);
  const sweep = () => json(service("select api.run_slot_renewals(100);"));
  const lifecycle = () => json(service("select api.run_post_lifecycle(100);"));
  const slots2 = (owner) => json(member(owner, "select api.get_my_slots_v2();"));
  const reminders = (owner) =>
    count(`private.outbox_events where kind='slot_renewal_reminder' and owner_id='${owner.id}'`);
  const claimReminders = () =>
    json(
      service("select api.claim_supported_notification_outbox(array['slot_renewal_reminder'],50);")
    );
  const finish = (job) =>
    q(
      service(
        `select api.complete_notification_outbox('${job.id}','${job.claim_token}',true,null);`
      )
    );
  /** One slot of `owner` ending in `days` (and the rest of a day). */
  const slotEndingIn = (owner, days) => {
    const paymentId = buy(owner, P30, 1);
    travel(owner, `${30 - days} days`);
    return grantsOf(paymentId)[0].id;
  };

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
      /^slot renewals: update not applied \(apply before the website release that uses it is deployed\); renewal payment lines: none \(column absent\); renewals issued: none \(column absent\); reminders queued: 0$/
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
    fails(renewSql(user("before"), ["00000000-0000-4000-8000-000000000000"]), "42883");
  });
  await check("the update refuses a drifted body and a drifted column, changing nothing", () => {
    const before = fingerprint();
    const original = q("select pg_get_functiondef('internal.post_funding(uuid)'::regprocedure);");
    q(`create or replace function internal.post_funding(p_post_id uuid)
         returns table(funded_until timestamptz, max_photos integer, max_videos integer)
         language sql stable set search_path to 'pg_catalog' as $f$ select null::timestamptz, 1, 1 $f$;`);
    assert.match(
      fails(step.sql, "55000"),
      /post_funding\(uuid\) [0-9a-f]{32} is not a reviewed body/
    );
    assert.match(preflight()[1][1], /internal.post_funding\(uuid\) is neither/);
    q(`${original};`);
    q("alter table private.post_activations add column continued text;");
    assert.match(fails(step.sql, "55000"), /column drift: private.post_activations.continued text/);
    q("alter table private.post_activations drop column continued;");
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
      /^slot renewals: already applied; renewal payment lines: 0; renewals issued: 0; reminders queued: 0$/
    );
    applySteps(database, [{ label: "slot renewals rollback", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before, "the rollback leaves the pre-update schema");
    assert.match(preflight()[0][1], /^slot renewals: update not applied/);
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
  });

  // ------------------------------------------------------------- window
  await check("renewing opens 14 days before a slot ends", () => {
    const ayanda = verified("ayanda");
    const paymentId = buy(ayanda, P30, 1);
    const [grant] = grantsOf(paymentId);
    fails(renewSql(ayanda, [grant.id]), "PT409", /renewal_not_open/);
    let mine = slots2(ayanda).slots[0];
    assert.equal(mine.renewable, false);
    assert.ok(
      truth(
        `'${mine.renew_opens_at}'::timestamptz=(select ends_at-interval '14 days' from private.entitlements where id='${grant.id}')`
      )
    );
    travel(ayanda, "15 days 23 hours");
    fails(renewSql(ayanda, [grant.id]), "PT409", /renewal_not_open/);
    travel(ayanda, "2 hours");
    mine = slots2(ayanda).slots[0];
    assert.equal(mine.renewable, true);
    assert.equal(renewQuote(ayanda, [grant.id]).slots, 1);
    assert.equal(count(`private.payments where owner_id='${ayanda.id}'`), 2);
  });

  // ------------------------------------------------------------- the boundary
  await check(
    "an early renewal starts exactly at the old end: one payment, the slot counted once, the post live across the boundary",
    () => {
      const bongi = verified("bongi");
      const first = buy(bongi, P30, 1);
      const [e1] = grantsOf(first);
      const listing = post(bongi);
      assert.equal(live(bongi, listing), e1.id);
      travel(bongi, "20 days");
      const oldEnd = scalar(`select ends_at from private.entitlements where id='${e1.id}';`);
      assert.equal(visibleUntil(listing), oldEnd);
      const quoted = renewQuote(bongi, [e1.id]);
      assert.equal(quoted.renewal, true);
      assert.equal(quoted.amount_cents, "6900");
      const snap = json(`select snapshot from private.payments where id='${quoted.payment_id}';`);
      assert.equal(snap.renewal, true);
      assert.equal(snap.invoice_description, "Renewal: Individual slot — 30 days");
      assert.equal(snap.cooling_off_consent.wording_version, "renewal-cooling-off-v1");
      assert.match(snap.cooling_off_consent.wording, /^My new days start on the date shown/);
      assert.match(snap.cooling_off_consent.wording, /full refund/);
      assert.doesNotMatch(snap.cooling_off_consent.wording, /starts now/);
      assert.deepEqual(
        snap.renewal_starts.map((s) => s.entitlement_id),
        [e1.id]
      );
      assert.ok(
        truth(`'${snap.renewal_starts[0].starts_at}'::timestamptz='${oldEnd}'::timestamptz`)
      );
      const settled = settle(bongi, quoted.payment_id);
      assert.equal(settled.outcome, "completed");
      const [e2] = grantsOf(quoted.payment_id);
      assert.ok(same(e2.starts, oldEnd), "the renewal starts exactly at the old end");
      assert.ok(truth(`'${e2.ends}'::timestamptz='${oldEnd}'::timestamptz+interval '30 days'`));
      assert.deepEqual([e2.slot, e2.renews, e2.line_renews], [e1.id, e1.id, e1.id]);
      // The old grant is never edited.
      assert.equal(scalar(`select ends_at from private.entitlements where id='${e1.id}';`), oldEnd);
      // The slot counts once; My slots shows the renewal.
      const mine = slots2(bongi);
      assert.equal(mine.individual.held, 1);
      assert.equal(mine.individual.renewed_ahead, 1);
      assert.equal(mine.slots.length, 1);
      assert.equal(mine.slots[0].id, e1.id);
      assert.ok(same(mine.slots[0].renewed_until, e2.ends));
      assert.deepEqual(
        mine.slots[0].renewals.map((r) => r.id),
        [e2.id]
      );
      assert.equal(json(member(bongi, "select api.get_my_slots();")).individual.held, 1);
      // The post's end moved with the renewal at once.
      assert.ok(same(visibleUntil(listing), e2.ends));
      assert.ok(publiclyVisible(listing));
      assert.ok(
        truth(
          `(select funded_until from internal.post_funding('${listing}'))='${e2.ends}'::timestamptz`
        )
      );
      // Across the boundary: the first period ended a second ago.
      travel(bongi, "10 days 1 second");
      assert.deepEqual(lifecycle().expired, 0);
      assert.equal(scalar(`select status from private.posts where id='${listing}';`), "live");
      assert.ok(publiclyVisible(listing), "the post stays visible across the boundary");
      // Waiting to move, the post still fills the slot.
      const other = post(bongi);
      fails(member(bongi, `select api.activate_post('${other}');`), "PT409", /capacity is in use/);
      assert.equal(sweep().moved, 1);
      assert.equal(sweep().moved, 0, "a post moves once");
      const activations =
        json(`select jsonb_agg(jsonb_build_object('grant',entitlement_id,'released',released_at is not null,
          'reason',release_reason,'continued',continued) order by activated_at) from private.post_activations
        where post_id='${listing}';`);
      assert.deepEqual(
        activations.map((a) => [a.grant, a.released, a.reason, a.continued]),
        [
          [e1.id, true, "entitlement_ended", false],
          [e2.id, false, null, true],
        ]
      );
      assert.equal(scalar(`select status from private.posts where id='${listing}';`), "live");
      const now = slots2(bongi);
      assert.deepEqual(
        now.slots.map((s) => [s.id, s.state, s.posts.map((p) => p.id)]),
        [[e2.id, "active", [listing]]]
      );
      // The moved post is not a post going live: with it gone, four new
      // posts may go live in the period, not three.
      q(`delete from private.posts where id='${listing}';`);
      for (let n = 0; n < 4; n++) {
        const next = post(bongi);
        json(member(bongi, `select api.activate_post('${next}');`));
        q(
          `update private.post_activations set released_at=clock_timestamp(),release_reason='deleted' where post_id='${next}' and released_at is null;`
        );
      }
      fails(member(bongi, `select api.activate_post('${other}');`), "PT409");
      // The 3-day grace starts only when the last renewal ends.
      const kept = post(bongi);
      q(
        `insert into private.post_activations(post_id,entitlement_id,owner_id) values('${kept}','${e2.id}','${bongi.id}');`
      );
      q(`update private.posts set status='live',published_at=now(),visible_until=(select ends_at from private.entitlements where id='${e2.id}') where id='${kept}';
         select internal.write_post_projection('${kept}');`);
      travel(bongi, "29 days 23 hours");
      assert.equal(lifecycle().expired, 0);
      assert.equal(scalar(`select status from private.posts where id='${kept}';`), "live");
      travel(bongi, "1 hour 1 second");
      assert.equal(lifecycle().expired, 1);
      assert.ok(
        truth(`(select deletes_at between statement_timestamp()+interval '71 hours' and statement_timestamp()+interval '73 hours'
          from private.posts where id='${kept}')`)
      );
      assert.equal(slots2(bongi).individual.held, 0);
    }
  );

  await check("renewing twice queues one period after the other", () => {
    const cebo = verified("cebo");
    const e1 = slotEndingIn(cebo, 5);
    const e2 = grantsOf(renew(cebo, [e1]))[0];
    fails(renewSql(cebo, [e1]), "PT409", /renewal_not_open/);
    // 25 days later the second period ends within 14 days.
    travel(cebo, "25 days");
    // Renewing from the old period's id renews the slot: after its last period.
    const e3 = grantsOf(renew(cebo, [e1]))[0];
    assert.ok(
      same(e3.starts, scalar(`select ends_at from private.entitlements where id='${e2.id}';`))
    );
    assert.deepEqual([e3.slot, e3.renews], [e1, e2.id]);
    assert.equal(slots2(cebo).individual.held, 1);
    const mine = slots2(cebo).slots;
    assert.deepEqual(
      mine.map((s) => s.id),
      [e2.id]
    );
    assert.ok(same(mine[0].renewed_until, e3.ends));
    // Two renewals of one grant can never both be active.
    assert.equal(
      scalar(
        `select indexdef from pg_indexes where schemaname='private' and indexname='entitlements_renews_active_idx';`
      ),
      "CREATE UNIQUE INDEX entitlements_renews_active_idx ON private.entitlements USING btree (renews_entitlement_id) WHERE ((renews_entitlement_id IS NOT NULL) AND (status = 'active'::text))"
    );
  });

  await check(
    "an overlapping renewal checkout returns the open one; one never sent to Ozow is replaced",
    () => {
      const dudu = verified("dudu");
      const a = slotEndingIn(dudu, 10);
      const b = grantsOf(buy(dudu, P30, 1))[0].id;
      travel(dudu, "1 second");
      q(
        `update private.entitlements set starts_at=starts_at-interval '20 days',ends_at=ends_at-interval '20 days' where id='${b}';`
      );
      const first = renewQuote(dudu, [a]);
      // The same slots and term continue the same payment.
      assert.equal(renewQuote(dudu, [a]).payment_id, first.payment_id);
      assert.equal(renewQuote(dudu, [a]).reused, true);
      // Never sent to Ozow: another set naming the slot replaces it.
      const both = renewQuote(dudu, [a, b]);
      assert.notEqual(both.payment_id, first.payment_id);
      assert.equal(
        scalar(`select status from private.payments where id='${first.payment_id}';`),
        "cancelled"
      );
      // Open at Ozow: another set naming one of its slots gets it back.
      open(dudu, both.payment_id);
      const back = renewQuote(dudu, [b]);
      assert.deepEqual(
        [back.payment_id, back.slots, back.renewal, back.reused],
        [both.payment_id, 2, true, true]
      );
      // One order per term: the new-slot checkout never takes the renewal
      // as an order of new slots, even for the same number of slots; it
      // gives it back to continue, check or cancel.
      const blocked = json(quoteSql(dudu, P30, 2));
      assert.deepEqual(
        [blocked.payment_id, blocked.slots, blocked.renewal, blocked.reused],
        [both.payment_id, 2, true, true]
      );
      assert.equal(
        scalar(`select status from private.payments where id='${both.payment_id}';`),
        "pending"
      );
      // A renewal never sent to Ozow is replaced by a new-slot order of the
      // same term, and the other way round.
      const ezra = verified("ezra");
      const c = slotEndingIn(ezra, 10);
      const unsent = renewQuote(ezra, [c]);
      const order = json(quoteSql(ezra, P30, 1));
      assert.notEqual(order.payment_id, unsent.payment_id);
      assert.equal(order.renewal, undefined);
      assert.equal(
        scalar(`select status from private.payments where id='${unsent.payment_id}';`),
        "cancelled"
      );
      const again = renewQuote(ezra, [c]);
      assert.equal(again.reused, false);
      assert.equal(
        scalar(`select status from private.payments where id='${order.payment_id}';`),
        "cancelled"
      );
    }
  );

  // ------------------------------------------------------------- renew all
  await check(
    "Renew all: three slots with different ends make one payment; each ends exactly its own period later; refunding one line withdraws only that slot",
    () => {
      const enhle = verified("enhle");
      const order = buy(enhle, P30, 3);
      const [a, b, c] = grantsOf(order).map((g) => g.id);
      travel(enhle, "20 days");
      q(`update private.entitlements set starts_at=starts_at-interval '3 days',ends_at=ends_at-interval '3 days' where id='${b}';
         update private.entitlements set starts_at=starts_at-interval '7 days',ends_at=ends_at-interval '7 days' where id='${c}';`);
      const listing = post(enhle);
      const funded = live(enhle, listing);
      const oldEnds = json(
        `select jsonb_object_agg(id,ends_at) from private.entitlements where id in ('${a}','${b}','${c}');`
      );
      assert.equal(new Set(Object.values(oldEnds)).size, 3);
      assert.ok(same(visibleUntil(listing), oldEnds[funded]));
      const renewal = renew(enhle, [a, b, c]);
      assert.equal(count(`private.payments where owner_id='${enhle.id}'`), 2);
      const renewed = grantsOf(renewal);
      assert.deepEqual(
        renewed.map((g) => g.slot),
        [a, b, c]
      );
      for (const g of renewed) {
        assert.equal(g.starts, oldEnds[g.slot]);
        assert.ok(
          truth(`'${g.ends}'::timestamptz='${oldEnds[g.slot]}'::timestamptz+interval '30 days'`)
        );
      }
      assert.equal(slots2(enhle).individual.held, 3);
      assert.equal(slots2(enhle).individual.renewed_ahead, 3);
      const queued = renewed.find((g) => g.slot === funded);
      assert.ok(same(visibleUntil(listing), queued.ends));
      // Refund the funded slot's renewal before it starts (the full line).
      const result = json(
        staff(
          admin,
          `select api.record_staff_slot_refund('${queued.line}','refunded','s14_cancellation','Cancelled before the renewal started','OZ-RENEW-1');`
        )
      );
      assert.deepEqual([result.status, result.payment_status], ["applied", "complete"]);
      assert.equal(
        scalar(
          `select amount_cents from private.payment_refund_requests where payment_line_id='${queued.line}';`
        ),
        "6900"
      );
      assert.deepEqual(
        grantsOf(renewal).map((g) => [g.slot, g.status]),
        [a, b, c].map((s) => [s, s === funded ? "revoked" : "active"])
      );
      // The post now ends with its current period again; the others keep theirs.
      assert.ok(same(visibleUntil(listing), oldEnds[funded]));
      assert.equal(scalar(`select status from private.posts where id='${listing}';`), "live");
      assert.equal(slots2(enhle).individual.held, 3);
      assert.equal(slots2(enhle).individual.renewed_ahead, 2);
      // The slot can be renewed again.
      const again = grantsOf(renew(enhle, [funded]))[0];
      assert.equal(again.starts, oldEnds[funded]);
      assert.ok(same(visibleUntil(listing), again.ends));
    }
  );

  await check("a chargeback of the current period keeps the queued renewal's own dates", () => {
    const fezile = verified("fezile");
    const firstOrder = buy(fezile, P30, 1);
    const [e1] = grantsOf(firstOrder);
    const listing = post(fezile);
    live(fezile, listing);
    travel(fezile, "25 days");
    const e2 = grantsOf(renew(fezile, [e1.id]))[0];
    q(
      `select internal.reverse_payment_line('${e1.line}','chargeback','Bank chargeback on the first period','${admin.id}');`
    );
    assert.equal(scalar(`select status from private.posts where id='${listing}';`), "expired");
    assert.equal(scalar(`select status from private.entitlements where id='${e1.id}';`), "revoked");
    // The renewal keeps the dates it was sold for (never edited).
    assert.equal(scalar(`select status from private.entitlements where id='${e2.id}';`), "active");
    assert.ok(
      same(scalar(`select starts_at from private.entitlements where id='${e2.id}';`), e2.starts)
    );
    assert.ok(
      same(e2.starts, scalar(`select ends_at from private.entitlements where id='${e1.id}';`))
    );
    // Still one slot, shown as its renewal waiting to start.
    const mine = slots2(fezile);
    assert.equal(mine.individual.held, 1);
    assert.deepEqual(
      mine.slots.map((s) => [s.id, s.state]),
      [[e2.id, "upcoming"]]
    );
  });

  // ------------------------------------------------------------- limits
  await check("the R10,000 online limit applies to the total of a renewal", () => {
    const gugu = verified("gugu");
    q(`insert into private.individual_slot_limits(identity_hmac,account_id,slot_limit,ends_at,reason,granted_by)
       values('${fingerprintOf("gugu")}','${gugu.id}',25,now()+interval '200 days','Checked dealer, interim offer','${admin.id}');`);
    const order = buy(gugu, P30, 25);
    const all = grantsOf(order).map((g) => g.id);
    travel(gugu, "20 days");
    fails(renewSql(gugu, all, P180), "PT413", /paid by invoice/);
    const most = renewQuote(gugu, all.slice(0, 24), P180);
    assert.equal(most.amount_cents, String(41400 * 24));
    fails(renewSql(gugu, all.slice(0, 2), P30, 13801), "PT428", /the price changed/);
  });

  await check("a person over their limit renews at most as many slots as the limit", () => {
    const hlengi = verified("hlengi");
    q(`insert into private.individual_slot_limits(identity_hmac,account_id,slot_limit,ends_at,reason,granted_by)
       values('${fingerprintOf("hlengi")}','${hlengi.id}',6,now()+interval '200 days','Checked dealer, interim offer','${admin.id}');`);
    const six = grantsOf(buy(hlengi, P30, 6)).map((g) => g.id);
    q(`update private.individual_slot_limits set revoked_at=now(),revoked_by='${admin.id}',revoke_reason='Business tools launched'
       where account_id='${hlengi.id}';`);
    travel(hlengi, "20 days");
    fails(renewSql(hlengi, six.slice(0, 5)), "PT429", /renew at most 4/);
    renew(hlengi, six.slice(0, 4));
    fails(renewSql(hlengi, six.slice(4, 5)), "PT429");
    // A new slot is refused too: six are held.
    fails(quoteSql(hlengi, P30, 1), "PT429");
    assert.equal(slots2(hlengi).individual.held, 6);
    assert.equal(slots2(hlengi).individual.renewed_ahead, 4);
  });

  await check(
    "no renewal before an accepted ID review, without the renewal's consent, or of the same slot twice",
    () => {
      const inga = verified("inga");
      const [x, y] = grantsOf(buy(inga, P30, 2)).map((g) => g.id);
      travel(inga, "20 days");
      fails(renewSql(inga, [x], P30, 6900, "false"), "22023", /cooling-off consent required/);
      fails(renewSql(inga, [x], P30, 6900, "null"), "22023", /cooling-off consent required/);
      fails(renewSql(inga, [x, x], P30, 13800), "22023", /once per order/);
      fails(
        member(inga, `select api.start_slot_renewal_checkout('{}'::uuid[],'${P30.id}',0,true);`),
        "22023"
      );
      fails(
        member(
          inga,
          `select api.start_slot_renewal_checkout(array['${x}',null]::uuid[],'${P30.id}',13800,true);`
        ),
        "22023"
      );
      const retired = q(
        "select id from private.plan_versions where plan_code='market_30d' and version=1;"
      );
      fails(
        member(inga, `select api.start_slot_renewal_checkout(${ids([x])},'${retired}',5000,true);`),
        "22023",
        /not on sale/
      );
      q(`set session_replication_role=replica;
        update private.accepted_identity_facts set revoked_at=now() where owner_id='${inga.id}';
        set session_replication_role=origin;`);
      fails(renewSql(inga, [y]), "PT412", /ID review must be accepted/);
      assert.equal(count(`private.payments where owner_id='${inga.id}' and status='pending'`), 0);
    }
  );

  await check(
    "another account cannot renew or see your slots; ended and other slots are not found",
    () => {
      const jabu = verified("jabu");
      const mine = slotEndingIn(jabu, 10);
      const stranger = verified("stranger");
      fails(renewSql(stranger, [mine]), "PT404", /slot_unavailable/);
      assert.equal(slots2(stranger).slots.length, 0);
      fails(asRole("anon", "select api.get_my_slots_v2();"), "42501");
      fails(
        asRole(
          "anon",
          `select api.start_slot_renewal_checkout(${ids([mine])},'${P30.id}',6900,true);`
        ),
        "42501"
      );
      fails(member(jabu, "select api.run_slot_renewals(10);"), "42501");
      // A free first post and a staff grant are not Individual slots.
      q(`insert into private.entitlements(owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at)
       values('${jabu.id}','staff_grant','${admin.id}',1,10,1,now(),now()+interval '5 days');`);
      const granted = q(
        `select id from private.entitlements where owner_id='${jabu.id}' and source='staff_grant';`
      );
      fails(renewSql(jabu, [granted]), "PT404");
      // An ended slot cannot be renewed (buy a new one instead).
      travel(jabu, "11 days");
      fails(renewSql(jabu, [mine]), "PT404");
    }
  );

  // ------------------------------------------------------------- settlement
  await check("a renewal paid after its slot ended starts at payment and counts as a slot", () => {
    const kagiso = verified("kagiso");
    const e1 = slotEndingIn(kagiso, 1);
    const quoted = renewQuote(kagiso, [e1]);
    travel(kagiso, "2 days");
    const settled = settle(kagiso, quoted.payment_id);
    assert.equal(settled.outcome, "completed");
    const [late] = grantsOf(quoted.payment_id);
    assert.ok(truth(`'${late.starts}'::timestamptz>statement_timestamp()-interval '1 minute'`));
    assert.deepEqual([late.slot, late.renews], [e1, e1]);
    assert.equal(slots2(kagiso).individual.held, 1);
  });

  await check(
    "a renewal sent to reconciliation is delivered by staff after the slot's last period",
    () => {
      const lindo = verified("lindo");
      const e1 = slotEndingIn(lindo, 10);
      const quoted = renewQuote(lindo, [e1]);
      open(lindo, quoted.payment_id);
      // The member cancels, then Ozow confirms the payment late.
      q(`update private.payments set status='cancelled' where id='${quoted.payment_id}';`);
      assert.equal(confirm(quoted.payment_id).outcome, "complete_unfulfillable_target");
      const done = json(
        staff(
          admin,
          `select api.activate_staff_paid_payment('${quoted.payment_id}','Customer paid; deliver the renewal');`
        )
      );
      assert.equal(done.entitlements, 1);
      const [e2] = grantsOf(quoted.payment_id);
      assert.ok(
        truth(
          `'${e2.starts}'::timestamptz=(select ends_at from private.entitlements where id='${e1}')`
        )
      );
      assert.equal(e2.slot, e1);
    }
  );

  // ------------------------------------------------------------- reminders
  await check(
    "one reminder per slot end, even when the job runs twice; only within 3 days; never for a free post or staff grant",
    () => {
      const mandla = verified("mandla");
      const soon = slotEndingIn(mandla, 2);
      const later = grantsOf(buy(mandla, P30, 1))[0].id;
      q(
        `update private.entitlements set starts_at=starts_at-interval '25 days',ends_at=ends_at-interval '25 days' where id='${later}';`
      );
      q(`insert into private.entitlements(owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at)
         values('${mandla.id}','staff_grant','${admin.id}',1,10,1,now()-interval '5 days',now()+interval '1 day');`);
      const payments = count("private.payments");
      sweep();
      sweep();
      assert.equal(reminders(mandla), 1);
      assert.equal(
        count(`private.outbox_events where kind='slot_renewal_reminder' and subject_id='${soon}'`),
        1
      );
      // No payment is ever started by the job: nothing renews by itself.
      assert.equal(count("private.payments"), payments);
      const jobs = claimReminders().filter((j) => j.owner_id === mandla.id);
      assert.equal(jobs.length, 1);
      const [job] = jobs;
      assert.equal(job.kind, "slot_renewal_reminder");
      assert.equal(job.subject_id, soon);
      assert.match(job.recipient, /^mandla-.*@example\.invalid$/);
      assert.equal(job.renewal_kind, "individual");
      assert.ok(
        truth(
          `'${job.slot_ends_at}'::timestamptz=(select ends_at from private.entitlements where id='${soon}')`
        )
      );
      // The other slot ends in 5 days: within 7, so the email offers Renew all.
      assert.equal(job.slot_renew_all, true);
      finish(job);
      sweep();
      assert.equal(reminders(mandla), 1, "a sent reminder is never queued again");
      // The second slot gets its own reminder once it is within 3 days.
      travel(mandla, "2 days 1 hour");
      sweep();
      assert.equal(reminders(mandla), 2);
      assert.equal(
        count(`private.outbox_events where kind='slot_renewal_reminder' and subject_id='${later}'`),
        1
      );
      const second = claimReminders().find((j) => j.subject_id === later);
      assert.equal(second.slot_renew_all, false);
      finish(second);
    }
  );

  await check(
    "no reminder to an unconfirmed address, nor for a slot renewed after it was queued",
    () => {
      const nandi = verified("nandi");
      const slot = slotEndingIn(nandi, 2);
      sweep();
      q(`update auth.users set email_confirmed_at=null where id='${nandi.id}';`);
      const [job] = claimReminders().filter((j) => j.owner_id === nandi.id);
      assert.equal(job.recipient, null);
      finish(job);
      // Renewed after queueing: finished without a send, and no new reminder.
      const owen = verified("owen");
      const owenSlot = slotEndingIn(owen, 2);
      sweep();
      assert.equal(reminders(owen), 1);
      renew(owen, [owenSlot]);
      const [stale] = claimReminders().filter((j) => j.owner_id === owen.id);
      assert.equal(stale.recipient, null);
      finish(stale);
      sweep();
      assert.equal(reminders(owen), 1);
      void slot;
    }
  );

  await check("the mail claim still takes every earlier kind with the reminder", () => {
    const kinds = [
      "payment_completed",
      "payment_reversed",
      "payment_reconciliation_required",
      "trial_started",
      "post_expired",
      "post_expiry_reminder",
      "draft_deletion_warning",
      "post_deleted",
      "verification_phone_confirmed",
      "identity_accepted",
      "enquiry_received",
      "account_warning",
      "content_hidden",
      "account_suspended",
      "account_banned",
      "appeal_decided",
      "business_check_update",
      "post_sold",
      "post_kept",
      "verification_returned",
    ];
    const list = (k) => `array[${k.map((x) => `'${x}'`).join(",")}]`;
    json(service(`select api.claim_supported_notification_outbox(${list(kinds)},1);`));
    json(
      service(
        `select api.claim_supported_notification_outbox(${list([...kinds, "slot_renewal_reminder"])},1);`
      )
    );
    fails(
      service(`select api.claim_supported_notification_outbox(${list(["no_such_kind"])},1);`),
      "22023",
      /unsupported mail kind/
    );
    // Each kind once: a repeated kind is refused, as a list too long was.
    fails(
      service(
        `select api.claim_supported_notification_outbox(${list(["post_kept", "post_kept"])},1);`
      ),
      "22023",
      /supported mail kinds required/
    );
    fails(
      service(
        `select api.claim_supported_notification_outbox(${list([...kinds, "slot_renewal_reminder", "post_kept"])},1);`
      ),
      "22023",
      /supported mail kinds required/
    );
  });

  // ------------------------------------------------------------- retention
  await check("retention removes a renewed slot's periods newest first", () => {
    const pule = verified("pule");
    const e1 = slotEndingIn(pule, 5);
    const renewal = renew(pule, [e1]);
    const e2 = grantsOf(renewal)[0].id;
    // Six years on: every period ended, its records are due.
    travel(pule, "2200 days");
    q(`set session_replication_role=replica;
       update private.invoices i set issued_at=issued_at-interval '2200 days' from private.payments p
         where p.id=i.payment_id and p.owner_id='${pule.id}';
       update private.provider_events e set received_at=received_at-interval '2200 days' from private.payments p
         where p.id=e.payment_id and p.owner_id='${pule.id}';
       set session_replication_role=origin;`);
    const run = () => json(service("select api.run_retention(500);"));
    run();
    assert.equal(count(`private.entitlements where id='${e2}'`), 0, "the renewal goes first");
    assert.equal(
      count(`private.entitlements where id='${e1}'`),
      1,
      "the first period waits for it"
    );
    run();
    run();
    assert.equal(count(`private.entitlements where id in ('${e1}','${e2}')`), 0);
    assert.equal(count(`private.payments where owner_id='${pule.id}'`), 0);
  });

  await check(
    "grants: members call the member commands, the sweep is the service's, helpers are closed",
    () => {
      const sigs = [
        "api.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean)",
        "api.get_my_slots_v2()",
        "api.run_slot_renewals(integer)",
        "internal.issue_slot_line_entitlements(uuid)",
        "internal.refresh_slot_chain_posts(uuid)",
        "internal.slot_chain_end(uuid)",
        "internal.slot_renewal_due(uuid,uuid)",
        "internal.individual_slots_extended(text,uuid,uuid,uuid[])",
        "internal.slot_renewal_window()",
      ];
      const grants = json(
        "select jsonb_object_agg(r.rolname||' '||f.sig,has_function_privilege(r.rolname,f.sig,'execute')) " +
          "from (values('anon'),('authenticated'),('service_role')) r(rolname), " +
          `(values${sigs.map((s) => `('${s}')`).join(",")}) f(sig);`
      );
      for (const [key, value] of Object.entries(grants)) {
        const [role, sig] = key.split(" ");
        const expected =
          sig === "api.run_slot_renewals(integer)"
            ? role === "service_role"
            : sig.startsWith("api.") && role === "authenticated";
        assert.equal(value, expected, key);
      }
      fails(
        "update private.payment_lines set renews_entitlement_id=null where renews_entitlement_id is not null;",
        "23514"
      );
    }
  );

  await check("the rollback refuses once a slot was renewed", () => {
    const now = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /slots were already renewed/);
    assert.equal(fingerprint(), now);
    assert.match(
      preflight()[0][1],
      /^slot renewals: already applied; renewal payment lines: [1-9][0-9]*; renewals issued: [1-9][0-9]*; reminders queued: [1-9][0-9]*$/
    );
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the renewal checkout", () => {
      const quentin = verified("quentin");
      const slot = slotEndingIn(quentin, 10);
      renew(quentin, [slot]);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Slot renewal checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
