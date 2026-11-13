#!/usr/bin/env node
// Behaviour checks for 20261113021223_staff_payment_fixes.sql: staff find and
// fix paid but not delivered (roadmap M3.4), refunds recorded with Ozow's
// reference, a reason code and a second approver above R1,000, and the
// receipt read for the payment email (M3.7).
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
// returns the schema fingerprint to the same values, then checks: a payment
// that was paid but not delivered is listed under "needs attention"; staff
// activate it (one slot per open line within the person's limit, or an
// add-on's window), with an audit row and the partner commission the trigger
// would have made; a refund or chargeback needs Ozow's reference and a reason
// code; a refund above R1,000 waits for a second, different staff member;
// one slot of an order is refunded alone; staff never act for their own
// identity; the receipt read matches the invoice; the grants; and that the
// rollback refuses once the new commands were used.
//
//   node --import tsx scripts/test-foundation-staff-payment-fixes.mjs
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

const UPDATE = "20261113021223_staff_payment_fixes.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");
const P30 = { id: "d6ca48e5-43be-40df-8d8c-72c98a6fda96", cents: 6900 };
const P180 = { id: "ce4ef578-344a-4816-ab6a-6961bec46621", cents: 41400 };
const sha = (text) => createHash("sha256").update(text).digest("hex");
const fingerprintOf = (label) =>
  `${createHash("sha256").update(`person-${label}`).digest("base64url").slice(0, 42)}A`;

const { check, current, passed: checks } = createChecks();

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
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
    -- An ended accepted review: the staff member was once reviewed as that person.
    create function vmtest.past_identity(p_owner uuid,p_staff uuid,p_fp text) returns void language plpgsql as $$
    begin
      perform set_config('session_replication_role','replica',true);
      insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by,revoked_at)
        values(p_owner,gen_random_uuid(),p_fp,p_staff,now());
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
    create or replace function internal.current_verified_identity(p_owner uuid) returns text
      language sql set search_path to 'pg_catalog' as $fn$
      select f.identity_hmac from private.accepted_identity_facts f where f.owner_id=p_owner and f.revoked_at is null
        and exists(select 1 from private.current_account_access a where a.id=p_owner) $fn$;`);
  const user = (label) => json(`select vmtest.member('${label}');`);
  const staffUser = (label, role) => json(`select vmtest.staff('${label}','${role}');`);
  const admin = staffUser("pay-admin", "admin");
  const admin2 = staffUser("pay-admin2", "admin");
  const unreviewedAdmin = staffUser("pay-admin3", "admin");
  const moderator = staffUser("pay-moderator", "moderator");
  const verified = (label) => {
    const m = user(label);
    m.fingerprint = fingerprintOf(label);
    q(`select vmtest.verified('${m.id}','${admin.id}','${m.fingerprint}');`);
    return m;
  };
  // Staff with an accepted ID review of their own (the third admin has none).
  q(`select vmtest.verified('${admin.id}','${admin2.id}','${fingerprintOf("pay-admin")}');`);
  q(`select vmtest.verified('${admin2.id}','${admin.id}','${fingerprintOf("pay-admin2")}');`);
  const post = (owner, kind, area) => q(`select vmtest.post('${owner.id}','${kind}','${area}');`);

  const quote = (owner, plan, slots) =>
    json(
      member(
        owner,
        `select api.start_slot_checkout('${plan.id}',${slots},${plan.cents * slots},true);`
      )
    );
  const open = (owner, paymentId) => {
    const lease = json(service(`select api.claim_checkout_request('${paymentId}','${owner.id}');`));
    if (lease.checkout_url) return;
    q(
      service(
        `select api.complete_checkout_request('${paymentId}','${owner.id}','${lease.claim_token}','req-${paymentId}','https://one.ozow.com/checkout/req-${paymentId}');`
      )
    );
  };
  /** Ozow's notice for the payment, applied as the notice handler does. */
  const notice = (paymentId, status, label = status) => {
    const row = json(
      `select jsonb_build_object('ref',merchant_reference,'amount',amount_cents) from private.payments where id='${paymentId}';`
    );
    const event = {
      payload_sha256: sha(`event-${paymentId}-${label}`),
      merchant_reference: row.ref,
      provider_request_id: `req-${paymentId}`,
      provider_transaction_id: status === "complete" ? `tx-${paymentId}` : "",
      status,
      amount_cents: Number(row.amount),
      currency: "ZAR",
    };
    return json(service(`select api.apply_provider_event($e$${JSON.stringify(event)}$e$::jsonb);`));
  };
  const buy = (owner, plan, slots) => {
    const quoted = quote(owner, plan, slots);
    open(owner, quoted.payment_id);
    assert.equal(notice(quoted.payment_id, "complete").outcome, "completed");
    return quoted.payment_id;
  };
  /** A payment the bank completed after the checkout was cancelled: paid, not delivered. */
  const paidNotDelivered = (owner, plan, slots) => {
    const quoted = quote(owner, plan, slots);
    open(owner, quoted.payment_id);
    assert.equal(notice(quoted.payment_id, "cancelled").outcome, "not_paid");
    const settled = notice(quoted.payment_id, "complete");
    assert.equal(settled.outcome, "complete_unfulfillable_target");
    assert.equal(settled.fulfillment_status, "needs_reconciliation");
    return quoted.payment_id;
  };
  const lines = (paymentId) =>
    json(
      `select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'status',l.status,
         'entitlement_status',(select e.status from private.entitlements e where e.payment_line_id=l.id)) order by l.line_number),'[]')
       from private.payment_lines l where l.payment_id='${paymentId}';`
    );
  const paymentRow = (paymentId) =>
    json(
      `select jsonb_build_object('status',status,'fulfillment',fulfillment_status) from private.payments where id='${paymentId}';`
    );
  const list = (who, filter) =>
    json(staff(who, `select api.get_staff_payment_list(1${filter ? `,'${filter}'` : ""});`));
  const activateSql = (who, paymentId, reason = "Paid after cancel; delivering") =>
    staff(who, `select api.activate_staff_paid_payment('${paymentId}','${reason}');`);
  const refundSql = (
    who,
    paymentId,
    ref,
    kind = "refunded",
    code = "billing_error",
    reason = "Charged twice by mistake"
  ) =>
    staff(
      who,
      `select api.record_staff_payment_refund('${paymentId}','${kind}','${code}','${reason}',${ref === null ? "null" : `'${ref}'`});`
    );
  const slotRefundSql = (who, lineId, ref, kind = "refunded", code = "s14_cancellation") =>
    staff(
      who,
      `select api.record_staff_slot_refund('${lineId}','${kind}','${code}','Cancelled within 14 days','${ref}');`
    );

  // ------------------------------------------------------------ before
  await check("before the update: preflight reads 'not applied', the commands are absent", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^staff payment fixes: update not applied \(apply before the website release that uses it is deployed\); paid but not delivered: 0; refunds waiting for approval: none \(table absent\)$/
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
    fails(staff(admin, "select api.get_staff_payment_list(1);"), "42883");
  });

  await check(
    "the update refuses without the reviewed slot bodies and with a drifted table",
    () => {
      const before = fingerprint();
      const original = q(
        "select pg_get_functiondef('internal.same_identity(uuid,uuid)'::regprocedure);"
      );
      q(`create or replace function internal.same_identity(p_one uuid, p_other uuid) returns boolean
      language sql stable set search_path to 'pg_catalog' as $fn$ select p_one = p_other $fn$;`);
      assert.match(
        fails(step.sql, "55000"),
        /apply 20261113002421_individual_slots_r69\.sql first/
      );
      assert.match(
        preflight()[1][1],
        /internal\.same_identity\(uuid,uuid\) is not the reviewed body/
      );
      q(original);
      q("create table private.payment_activations(payment_id uuid primary key);");
      assert.match(
        fails(step.sql, "55000"),
        /table drift: private\.payment_activations payment_id/
      );
      q("drop table private.payment_activations;");
      assert.equal(fingerprint(), before);
    }
  );

  // A payment paid but not delivered before the update: the preflight counts it.
  const early = verified("early");
  const earlyPayment = paidNotDelivered(early, P30, 2);
  assert.match(preflight()[0][1], /paid but not delivered: 1;/);

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
      /^staff payment fixes: already applied; paid but not delivered: 1; refunds waiting for approval: 0$/
    );
    applySteps(database, [{ label: "staff payment fixes rollback", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before, "the rollback leaves the pre-update schema");
    assert.match(preflight()[0][1], /^staff payment fixes: update not applied/);
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
  });

  // ------------------------------------------------------- needs attention
  await check("the staff list shows delivery status and the paid-but-not-delivered filter", () => {
    const delivered = buy(verified("delivered"), P30, 1);
    const all = list(admin);
    assert.equal(all.needs_attention, 1);
    assert.equal(all.awaiting_approval, 0);
    const rows = new Map(all.items.map((i) => [i.id, i]));
    assert.equal(rows.get(earlyPayment).fulfillment_status, "needs_reconciliation");
    assert.equal(rows.get(earlyPayment).status, "complete");
    assert.equal(rows.get(earlyPayment).lines.length, 2);
    assert.equal(rows.get(delivered).fulfillment_status, "fulfilled");
    assert.equal(rows.get(delivered).activated_at, null);
    const attention = list(admin, "needs_attention");
    assert.deepEqual(
      attention.items.map((i) => i.id),
      [earlyPayment]
    );
    assert.equal(attention.total, 1);
    // The earlier list keeps its reply shape for the release before this one.
    const old = json(staff(admin, "select api.get_frontend_staff_payments(1);"));
    assert.deepEqual(Object.keys(old.items[0]).sort(), [
      "amount_cents",
      "area",
      "created_at",
      "description",
      "id",
      "status",
      "user_id",
    ]);
    fails(staff(admin, "select api.get_staff_payment_list(1,'anything');"), "22023");
    fails(staff(moderator, "select api.get_staff_payment_list(1);"), "42501");
    fails(member(early, "select api.get_staff_payment_list(1);"), "42501");
  });

  // ------------------------------------------------------------- activate
  await check("staff activate what was paid for: slots, audit row and commission", () => {
    const partner = user("activation-partner");
    q(`select set_config('session_replication_role','replica',false);
      insert into private.partners(account_id,code,status,commission_bps,created_by)
        values('${partner.id}','PARTNER5','active',2000,'${admin.id}');
      insert into private.account_acquisitions(account_id,source,partner_id)
        values('${early.id}','partner',(select id from private.partners where account_id='${partner.id}'));
      select set_config('session_replication_role','origin',false);`);
    assert.equal(count(`private.partner_commissions where payment_id='${earlyPayment}'`), 0);
    // Refused: a member, a moderator, staff without their own ID review, staff
    // acting on their own identity, a missing reason.
    fails(
      member(
        early,
        `select api.activate_staff_paid_payment('${earlyPayment}','Activate mine please');`
      ),
      "42501"
    );
    fails(activateSql(moderator, earlyPayment), "42501", /capability not granted/);
    fails(activateSql(unreviewedAdmin, earlyPayment), "42501", /accepted ID review of their own/);
    fails(activateSql(admin, earlyPayment, "no"), "22023");
    const mirror = user("early-second-account");
    q(`select vmtest.past_identity('${admin.id}','${admin2.id}','${early.fingerprint}');`);
    fails(activateSql(admin, earlyPayment), "42501", /different staff member must activate/);
    q(`set session_replication_role=replica;
       delete from private.accepted_identity_facts where owner_id='${admin.id}' and identity_hmac='${early.fingerprint}';
       set session_replication_role=origin;`);
    assert.ok(mirror.id);
    const result = json(activateSql(admin, earlyPayment));
    assert.deepEqual(
      [
        result.fulfillment_status,
        result.entitlements,
        result.addon_window,
        result.commissions,
        result.repeated,
      ],
      ["fulfilled", 2, false, 2, false]
    );
    assert.deepEqual(paymentRow(earlyPayment), { status: "complete", fulfillment: "fulfilled" });
    assert.deepEqual(
      lines(earlyPayment).map((l) => [l.status, l.entitlement_status]),
      [
        ["open", "active"],
        ["open", "active"],
      ]
    );
    // The same commission the trigger makes for a delivered payment: one per line.
    assert.deepEqual(
      json(`select jsonb_agg(jsonb_build_array(c.base_cents,c.amount_cents,c.status,c.payment_line_id is not null) order by c.created_at)
        from private.partner_commissions c where c.payment_id='${earlyPayment}';`),
      [
        [6900, 1380, "pending", true],
        [6900, 1380, "pending", true],
      ]
    );
    // The audit row, in the table and in the staff audit trail.
    assert.equal(
      q(
        `select actor_id||'|'||reason from private.payment_activations where payment_id='${earlyPayment}';`
      ),
      `${admin.id}|Paid after cancel; delivering`
    );
    assert.equal(
      count(
        `private.frontend_staff_audit_events where target_id='${earlyPayment}' and action='payment:activated' and actor_id='${admin.id}'`
      ),
      1
    );
    // The member sees the slots.
    const mine = json(member(early, "select api.get_my_slots();"));
    assert.equal(mine.individual.held, 2);
    // Repeating returns the same; anything else is refused.
    assert.equal(json(activateSql(admin, earlyPayment)).repeated, true);
    fails(activateSql(admin2, earlyPayment), "PT409", /already activated/);
    fails("update private.payment_activations set reason='Changed later';", "23514");
    assert.equal(list(admin, "needs_attention").total, 0);
    assert.ok(list(admin).items.find((i) => i.id === earlyPayment).activated_at);
  });

  await check(
    "activation stays within the person's slot limit and refuses a delivered payment",
    () => {
      const thabo = verified("thabo");
      const late = paidNotDelivered(thabo, P30, 2);
      buy(thabo, P30, 3);
      fails(activateSql(admin, late), "PT429", /raise the limit or refund/);
      assert.equal(paymentRow(late).fulfillment, "needs_reconciliation");
      const delivered = buy(verified("someone"), P30, 1);
      fails(activateSql(admin, delivered), "PT409", /not delivered can be activated/);
      // A refund is the way out: the paid but undelivered order is refunded in full.
      const refunded = json(refundSql(admin, late, "OZ-REF-LIMIT-1"));
      assert.equal(refunded.status, "applied");
      assert.deepEqual(paymentRow(late), { status: "refunded", fulfillment: "reversed" });
    }
  );

  await check(
    "an add-on paid but not delivered gets its window while the post can carry it",
    () => {
      const ayanda = verified("ayanda");
      buy(ayanda, P30, 1);
      const listing = post(ayanda, "listing", "market");
      json(member(ayanda, `select api.activate_post('${listing}');`));
      q(
        `update private.posts set status='live',published_at=now(),visible_until=now()+interval '20 days' where id='${listing}';`
      );
      const urgent = q(
        "select id from private.addon_versions where kind='urgent' and retired_at is null order by version desc limit 1;"
      );
      const quoted = json(member(ayanda, `select api.start_checkout('${urgent}','${listing}');`));
      open(ayanda, quoted.payment_id);
      notice(quoted.payment_id, "cancelled");
      assert.equal(
        notice(quoted.payment_id, "complete").fulfillment_status,
        "needs_reconciliation"
      );
      const result = json(activateSql(admin, quoted.payment_id));
      assert.deepEqual([result.entitlements, result.addon_window], [0, true]);
      assert.equal(
        count(
          `private.post_addon_windows where payment_id='${quoted.payment_id}' and revoked_at is null`
        ),
        1
      );
      // The receipt read for the add-on.
      const receipt = json(service(`select api.get_payment_receipt('${quoted.payment_id}');`));
      assert.equal(receipt.product_kind, "addon");
      assert.equal(receipt.slots, null);
      assert.equal(receipt.label, "Urgent add-on");
      // A second add-on payment whose post ended is refused.
      const second = json(member(ayanda, `select api.start_checkout('${urgent}','${listing}');`));
      open(ayanda, second.payment_id);
      notice(second.payment_id, "cancelled");
      notice(second.payment_id, "complete");
      q(`update private.posts set status='expired' where id='${listing}';`);
      fails(activateSql(admin, second.payment_id), "PT409", /can no longer carry this add-on/);
    }
  );

  // ------------------------------------------------------------- refunds
  await check("a refund or chargeback needs Ozow's reference and a reason code", () => {
    const lindi = verified("lindi");
    const paid = buy(lindi, P30, 1);
    fails(refundSql(admin, paid, null), "22023", /Ozow refund reference required/);
    fails(refundSql(admin, paid, "  "), "22023", /Ozow refund reference required/);
    fails(refundSql(admin, paid, "bad ref with spaces"), "22023", /4 to 100 letters/);
    fails(refundSql(admin, paid, "OZ-1", "refunded", "goodwill"), "22023", /reason code/);
    fails(refundSql(admin, paid, "OZ-REF-1", "refunded", "billing_error", "x"), "22023");
    fails(refundSql(moderator, paid, "OZ-REF-1"), "42501", /capability not granted/);
    fails(refundSql(unreviewedAdmin, paid, "OZ-REF-1"), "42501", /accepted ID review of their own/);
    assert.deepEqual(paymentRow(paid), { status: "complete", fulfillment: "fulfilled" });
    // R69: no approval needed; it takes effect at once.
    const result = json(refundSql(admin, paid, "OZ-REF-1"));
    assert.deepEqual(
      [result.status, result.kind, result.payment_status, result.repeated],
      ["applied", "refunded", "refunded", false]
    );
    assert.deepEqual(paymentRow(paid), { status: "refunded", fulfillment: "reversed" });
    assert.equal(
      q(
        `select reason_code||'|'||ozow_reference||'|'||account_id||'|'||amount_cents||'|'||needs_approval from private.payment_refund_requests where payment_id='${paid}';`
      ),
      `billing_error|OZ-REF-1|${lindi.id}|6900|false`
    );
    assert.equal(count(`private.frontend_payment_reversals where payment_id='${paid}'`), 1);
    assert.equal(
      count(
        `private.frontend_staff_audit_events where target_id='${paid}' and action in ('payment:refunded','payment:refunded_recorded')`
      ),
      2
    );
    // The same request again is a repeat; the reference is used once.
    assert.equal(json(refundSql(admin, paid, "OZ-REF-1")).repeated, true);
    const other = buy(verified("lindi-friend"), P30, 1);
    fails(refundSql(admin, other, "OZ-REF-1"), "PT409", /already recorded/);
    fails(refundSql(admin, paid, "OZ-REF-2"), "PT409", /not reversed can be refunded/);
    // A chargeback takes effect at once, whatever the amount.
    const big = buy(verified("chargeback"), P180, 4);
    const chargeback = json(refundSql(admin, big, "OZ-CB-1", "chargeback", "duplicate"));
    assert.equal(chargeback.status, "applied");
    assert.deepEqual(paymentRow(big), { status: "chargeback", fulfillment: "reversed" });
    // Records are never changed, and only the account that paid gets a refund.
    fails("update private.payment_refund_requests set reason='Changed later';", "23514");
    fails(
      `insert into private.payment_refund_requests(payment_id,account_id,kind,reason_code,reason,ozow_reference,amount_cents,needs_approval,status,requested_by,applied_at,released_activations)
       values('${other}','${lindi.id}','refunded','billing_error','Wrong account','OZ-WRONG-1',6900,false,'applied','${admin.id}',now(),0);`,
      "23514",
      /account that paid/
    );
    fails(
      `insert into private.payment_refund_requests(payment_id,account_id,kind,reason_code,reason,ozow_reference,amount_cents,needs_approval,status,requested_by,applied_at,released_activations)
       values('${other}',(select owner_id from private.payments where id='${other}'),'refunded','billing_error','Wrong amount','OZ-WRONG-2',100,false,'applied','${admin.id}',now(),0);`,
      "23514",
      /paid amount/
    );
  });

  await check("a refund above R1,000 waits for a second, different staff member", () => {
    const sipho = verified("sipho");
    const order = buy(sipho, P180, 4); // 165,600 cents
    const waiting = json(
      refundSql(admin, order, "OZ-BIG-1", "refunded", "our_failure_after_fix_offered")
    );
    assert.deepEqual([waiting.status, waiting.payment_status], ["awaiting_approval", "complete"]);
    assert.deepEqual(paymentRow(order), { status: "complete", fulfillment: "fulfilled" });
    assert.ok(lines(order).every((l) => l.entitlement_status === "active"));
    const listed = list(admin2, "awaiting_approval");
    assert.equal(listed.awaiting_approval, 1);
    assert.equal(listed.items[0].id, order);
    assert.equal(listed.items[0].refund_request.requested_by_me, false);
    assert.equal(list(admin, "awaiting_approval").items[0].refund_request.requested_by_me, true);
    // Nothing else can be recorded on that payment while it waits.
    fails(refundSql(admin2, order, "OZ-BIG-2"), "PT409", /waiting for approval/);
    fails(slotRefundSql(admin2, lines(order)[0].id, "OZ-BIG-3"), "PT409", /waiting for approval/);
    const approve = (who) =>
      staff(who, `select api.approve_staff_payment_refund('${waiting.request_id}');`);
    // Not by the requester, nor by another account of the requester's identity.
    fails(approve(admin), "42501", /different staff member must approve/);
    const adminTwin = json(`select vmtest.staff('pay-admin-twin','admin');`);
    q(
      `select vmtest.past_identity('${adminTwin.id}','${admin2.id}','${fingerprintOf("pay-admin")}');`
    );
    fails(approve(adminTwin), "42501", /different staff member must approve/);
    fails(approve(moderator), "42501", /capability not granted/);
    fails(approve(unreviewedAdmin), "42501", /accepted ID review of their own/);
    const applied = json(approve(admin2));
    assert.deepEqual([applied.status, applied.payment_status], ["applied", "refunded"]);
    assert.deepEqual(paymentRow(order), { status: "refunded", fulfillment: "reversed" });
    assert.ok(
      lines(order).every((l) => l.status === "reversed" && l.entitlement_status === "revoked")
    );
    assert.equal(
      q(
        `select approved_by from private.payment_refund_requests where id='${waiting.request_id}';`
      ),
      admin2.id
    );
    assert.equal(
      count(
        `private.frontend_staff_audit_events where target_id='${order}' and action='payment:refunded_approved' and actor_id='${admin2.id}'`
      ),
      1
    );
    assert.equal(json(approve(admin2)).repeated, true);
    // A waiting refund can be declined (here withdrawn by its requester), then recorded again.
    const thandeka = verified("thandeka");
    const second = buy(thandeka, P180, 3); // 124,200 cents
    const asked = json(refundSql(admin, second, "OZ-BIG-4", "refunded", "breach_credit"));
    fails(
      staff(admin, `select api.decline_staff_payment_refund('${asked.request_id}','x');`),
      "22023"
    );
    assert.equal(
      json(
        staff(
          admin,
          `select api.decline_staff_payment_refund('${asked.request_id}','Wrong reference typed');`
        )
      ).status,
      "declined"
    );
    fails(
      staff(admin2, `select api.approve_staff_payment_refund('${asked.request_id}');`),
      "PT409",
      /no longer waiting/
    );
    assert.equal(paymentRow(second).status, "complete");
    assert.equal(
      json(refundSql(admin, second, "OZ-BIG-5", "refunded", "breach_credit")).status,
      "awaiting_approval"
    );
  });

  await check("one slot of a multi-slot order is refunded alone, with the same rules", () => {
    const nandi = verified("nandi");
    const order = buy(nandi, P30, 3);
    const [first, ...rest] = lines(order);
    fails(
      staff(
        admin,
        `select api.record_staff_slot_refund('${first.id}','refunded','s14_cancellation','Cancelled within 14 days',null);`
      ),
      "22023",
      /Ozow refund reference required/
    );
    const result = json(slotRefundSql(admin, first.id, "OZ-SLOT-1"));
    assert.deepEqual(
      [result.status, result.payment_status, result.line_id],
      ["applied", "complete", first.id]
    );
    assert.deepEqual(
      lines(order).map((l) => [l.status, l.entitlement_status]),
      [
        ["reversed", "revoked"],
        ["open", "active"],
        ["open", "active"],
      ]
    );
    assert.equal(
      q(
        `select payment_line_id||'|'||amount_cents||'|'||reason_code from private.payment_refund_requests where ozow_reference='OZ-SLOT-1';`
      ),
      `${first.id}|6900|s14_cancellation`
    );
    assert.equal(
      count(
        `private.frontend_staff_audit_events where id='payment_slot:${first.id}' and action='payment:slot_refunded'`
      ),
      1
    );
    // The whole payment can no longer be refunded in one go.
    fails(refundSql(admin, order, "OZ-SLOT-2"), "PT409", /refund its other slots one by one/);
    fails(slotRefundSql(admin, first.id, "OZ-SLOT-3"), "PT409", /only an open slot/);
    // Staff never refund their own identity's slot.
    q(`select vmtest.past_identity('${admin2.id}','${admin.id}','${nandi.fingerprint}');`);
    fails(slotRefundSql(admin2, rest[0].id, "OZ-SLOT-4"), "42501", /different staff member/);
    q(`set session_replication_role=replica;
       delete from private.accepted_identity_facts where owner_id='${admin2.id}' and identity_hmac='${nandi.fingerprint}';
       set session_replication_role=origin;`);
    assert.equal(
      json(slotRefundSql(admin2, rest[0].id, "OZ-SLOT-4", "chargeback", "duplicate")).status,
      "applied"
    );
    assert.equal(json(slotRefundSql(admin, rest[1].id, "OZ-SLOT-5")).payment_status, "refunded");
    assert.deepEqual(paymentRow(order), { status: "refunded", fulfillment: "reversed" });
  });

  // ------------------------------------------------------------- receipt
  await check("the receipt read matches the invoice, for the service only", () => {
    const zola = verified("zola");
    const order = buy(zola, P30, 2);
    const receipt = json(service(`select api.get_payment_receipt('${order}');`));
    const invoice = json(
      `select jsonb_build_object('n',invoice_number,'at',issued_at,'d',description) from private.invoices where payment_id='${order}';`
    );
    const payment = json(
      `select jsonb_build_object('ref',merchant_reference,'tx',provider_transaction_id,'at',completed_at,'label',snapshot->>'label') from private.payments where id='${order}';`
    );
    assert.deepEqual(receipt, {
      payment_id: order,
      owner_id: zola.id,
      amount_cents: 13800,
      currency: "ZAR",
      completed_at: payment.at,
      product_kind: "plan",
      label: payment.label,
      slots: 2,
      invoice_description: invoice.d,
      invoice_number: invoice.n,
      issued_at: invoice.at,
      merchant_reference: payment.ref,
      provider_transaction_id: payment.tx,
      status: "complete",
      fulfillment_status: "fulfilled",
    });
    assert.equal(q(service("select api.get_payment_receipt(gen_random_uuid()) is null;")), "t");
    fails(asRole("anon", `select api.get_payment_receipt('${order}');`), "42501");
    fails(member(zola, `select api.get_payment_receipt('${order}');`), "42501");
    fails(staff(admin, `select api.get_payment_receipt('${order}');`), "42501");
  });

  await check(
    "grants: staff commands for authenticated, the receipt for the service, tables closed",
    () => {
      const grants = json(
        "select jsonb_object_agg(r.rolname||' '||f.sig,has_function_privilege(r.rolname,f.sig,'execute')) " +
          "from (values('anon'),('authenticated'),('service_role')) r(rolname), " +
          "(values('api.get_staff_payment_list(integer,text)'),('api.activate_staff_paid_payment(uuid,text)')," +
          "('api.record_staff_payment_refund(uuid,text,text,text,text)'),('api.record_staff_slot_refund(uuid,text,text,text,text)')," +
          "('api.approve_staff_payment_refund(uuid)'),('api.decline_staff_payment_refund(uuid,text)')," +
          "('api.get_payment_receipt(uuid)'),('internal.payment_delivery_commission(uuid)')," +
          "('internal.assert_staff_refund_input(text,text,text,text)')) f(sig);"
      );
      for (const [key, value] of Object.entries(grants)) {
        const [role, sig] = key.split(" ");
        const expected = sig.startsWith("api.get_payment_receipt")
          ? role === "service_role"
          : role === "authenticated" && sig.startsWith("api.");
        assert.equal(value, expected, key);
      }
      for (const table of ["private.payment_activations", "private.payment_refund_requests"])
        assert.equal(
          q(
            `select bool_or(has_table_privilege(r,'${table}','select,insert,update,delete')) from unnest(array['anon','authenticated','service_role']) r;`
          ),
          "f",
          table
        );
    }
  );

  await check("the rollback refuses once the new commands were used", () => {
    const now = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /staff already used the new commands/);
    assert.equal(fingerprint(), now);
    assert.match(
      preflight()[0][1],
      /^staff payment fixes: already applied; paid but not delivered: [0-9]+; refunds waiting for approval: 1$/
    );
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the staff payment commands", () => {
      assert.equal(typeof list(admin).needs_attention, "number");
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Staff payment fix checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
