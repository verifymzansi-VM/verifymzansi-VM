#!/usr/bin/env node
// Behaviour checks for 20261113151748_ozow_api_refunds.sql: staff refunds sent
// to Ozow by the server only after the approval rules pass, a separate admin
// record of a refund made in the Ozow dashboard, Ozow's refund outcomes and the
// daily read-only refund check.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Staff call the production API commands as `authenticated` with
// synthetic claims, a live AAL2 session and a verified authenticator app; the
// server's commands run as `service_role`; payments are completed through the
// service commands as the notice handler does. Ozow is never contacted: the
// checks stand in for the server and hand the database the answers Ozow would
// give. The script runs the read-only preflight, checks the update's refusal,
// proves apply -> rollback -> apply, then the refund rules: nothing is sent for
// a waiting or declined refund, a record is handed to the sender once (also on
// a repeat, a retry and a second claim), only Complete reverses, a failed,
// returned, unmatched, mismatched or stuck refund alerts staff, the guard keeps
// every record's facts, and only the server may report Ozow's answers.
//
//   node --import tsx scripts/test-foundation-ozow-api-refunds.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  assertReadOnlyPreflight,
  createChecks,
  sqlHelpers,
  updateCheckViews,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261113151748_ozow_api_refunds.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
// Plan versions on sale since 20261113002421_individual_slots_r69.sql.
const PLANS = {
  days30: { id: "d6ca48e5-43be-40df-8d8c-72c98a6fda96", cents: 6900 },
  days180: { id: "ce4ef578-344a-4816-ab6a-6961bec46621", cents: 41400 },
};
const SERVICE_COMMANDS = [
  "api.claim_ozow_refund_send(uuid)",
  "api.list_ozow_refund_sends_due(integer)",
  "api.record_ozow_refund_send(uuid,jsonb)",
  "api.apply_ozow_refund_status(jsonb)",
  "api.reconcile_ozow_refunds(jsonb)",
  "api.claim_ozow_refund_checks(integer)",
  "api.report_ozow_refund_missing(uuid)",
];
const STAFF_COMMANDS = [
  "api.request_staff_ozow_refund(uuid,uuid,text,text)",
  "api.record_staff_dashboard_refund(uuid,uuid,text,text,uuid)",
  "api.get_staff_ozow_refunds(uuid[])",
  "api.close_staff_ozow_refund(uuid,text)",
];
const ROLES = ["anon", "authenticated", "service_role"];
const digest = (text, encoding) => createHash("sha256").update(text).digest(encoding);
const sha = (text) => digest(text, "hex");
const fingerprintOf = (label) => `${digest(`person-${label}`, "base64url").slice(0, 42)}A`;
const literal = (value) => `$j$${JSON.stringify(value)}$j$::jsonb`;

const started = Date.now();
const { check, current, passed: checks } = createChecks();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { q, json, fails, member, staff, service } = sqlHelpers(database, current);
  const { fingerprint, preflightRows: preflight } = updateCheckViews(database, current, {
    preflight: PREFLIGHT,
  });
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const callers = (sig) =>
    ROLES.filter(
      (role) => q(`select has_function_privilege('${role}','${sig}','execute');`) === "t"
    );

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
    create or replace function internal.current_verified_identity(p_owner uuid) returns text
      language sql set search_path to 'pg_catalog' as $fn$
      select f.identity_hmac from private.accepted_identity_facts f where f.owner_id=p_owner and f.revoked_at is null
        and exists(select 1 from private.current_account_access a where a.id=p_owner) $fn$;`);
  const user = (label) => json(`select vmtest.member('${label}');`);
  const staffUser = (label, role) => json(`select vmtest.staff('${label}','${role}');`);
  const admin = staffUser("ozow-admin", "admin");
  const admin2 = staffUser("ozow-admin2", "admin");
  const moderator = staffUser("ozow-moderator", "moderator");
  q(`select vmtest.verified('${admin.id}','${admin2.id}','${fingerprintOf("ozow-admin")}');`);
  q(`select vmtest.verified('${admin2.id}','${admin.id}','${fingerprintOf("ozow-admin2")}');`);
  q(
    `select vmtest.verified('${moderator.id}','${admin.id}','${fingerprintOf("ozow-moderator")}');`
  );
  const verified = (label) => {
    const m = user(label);
    q(`select vmtest.verified('${m.id}','${admin.id}','${fingerprintOf(label)}');`);
    return m;
  };
  /** A completed slot order; Ozow's transaction id is a UUID unless `tx` says otherwise. */
  const buy = (owner, plan, slots, tx = randomUUID()) => {
    const quoted = json(
      member(
        owner,
        `select api.start_slot_checkout('${plan.id}',${slots},${plan.cents * slots},true);`
      )
    );
    const paymentId = quoted.payment_id;
    const lease = json(service(`select api.claim_checkout_request('${paymentId}','${owner.id}');`));
    if (!lease.checkout_url)
      q(
        service(
          `select api.complete_checkout_request('${paymentId}','${owner.id}','${lease.claim_token}','req-${paymentId}','https://one.ozow.com/checkout/req-${paymentId}');`
        )
      );
    const row = json(
      `select jsonb_build_object('ref',merchant_reference,'amount',amount_cents) from private.payments where id='${paymentId}';`
    );
    const event = {
      payload_sha256: sha(`event-${paymentId}-complete`),
      merchant_reference: row.ref,
      provider_request_id: `req-${paymentId}`,
      provider_transaction_id: tx,
      status: "complete",
      amount_cents: Number(row.amount),
      currency: "ZAR",
    };
    assert.equal(
      json(service(`select api.apply_provider_event(${literal(event)});`)).outcome,
      "completed"
    );
    return { id: paymentId, tx, cents: Number(row.amount) };
  };
  const lines = (paymentId) =>
    json(
      `select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'status',l.status,'cents',l.amount_cents) order by l.line_number),'[]')
       from private.payment_lines l where l.payment_id='${paymentId}';`
    );
  const payStatus = (paymentId) =>
    q(`select status from private.payments where id='${paymentId}';`);
  const activeSlots = (paymentId) =>
    Number(
      q(
        `select count(*) from private.entitlements where payment_id='${paymentId}' and status<>'revoked';`
      )
    );
  const record = (id) =>
    json(`select to_jsonb(r) from private.payment_refund_requests r where r.id='${id}';`);
  const problem = (paymentId, reason) =>
    json(`select coalesce((select jsonb_build_object('alert',p.needs_alert,'source',p.source,'n',p.occurrences)
      from private.payment_problems p where p.payment_id is not distinct from ${paymentId ? `'${paymentId}'` : "null"}
        and p.reason='${reason}'),'null'::jsonb);`);
  const request = (who, paymentId, lineId = null, reason = "Cancelled within 14 days") =>
    staff(
      who,
      `select api.request_staff_ozow_refund('${paymentId}',${lineId ? `'${lineId}'` : "null"},'s14_cancellation','${reason}');`
    );
  const dashboard = (who, paymentId, refundId, lineId = null) =>
    staff(
      who,
      `select api.record_staff_dashboard_refund('${paymentId}',${lineId ? `'${lineId}'` : "null"},'billing_error','Refunded by hand in Ozow','${refundId}');`
    );
  const claim = (id) => json(service(`select api.claim_ozow_refund_send('${id}');`));
  const sendResult = (id, result) =>
    json(service(`select api.record_ozow_refund_send('${id}',${literal(result)});`));
  const ozowStatus = (fact, source = "refund_notice") =>
    json(service(`select api.apply_ozow_refund_status(${literal({ ...fact, source })});`));
  const fact = (claimed, status, refundId = randomUUID()) => ({
    refund_id: refundId,
    transaction_id: claimed.transaction_id,
    amount_cents: claimed.amount_cents,
    status,
    requested_at: new Date().toISOString(),
    completed_at: status === "Complete" ? new Date().toISOString() : null,
  });
  const backdate = (id, column, interval) =>
    q(`alter table private.payment_refund_requests disable trigger payment_refund_requests_guard;
       update private.payment_refund_requests set ${column}=${column}-interval '${interval}' where id='${id}';
       alter table private.payment_refund_requests enable trigger payment_refund_requests_guard;`);

  // ------------------------------------------------------------ before
  await check("before the update: preflight reads 'not applied'", () => {
    assertReadOnlyPreflight(database, PREFLIGHT);
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^ozow api refunds: update not applied .*; refunds waiting for approval: 0; refunds through Ozow not settled: none \(update not applied\)$/
    );
  });

  await check(
    "the update refuses (55000) when a function it needs is not the reviewed body",
    () => {
      const before = fingerprint();
      const original = q(
        "select pg_get_functiondef('internal.refund_needs_approval(text,bigint,bigint)'::regprocedure);"
      );
      q(`create or replace function internal.refund_needs_approval(p_kind text, p_refunded_before bigint, p_amount bigint)
      returns boolean language sql immutable set search_path to 'pg_catalog' as $fn$ select false $fn$;`);
      assert.match(fails(step.sql, "55000"), /ozow api refunds precondition/);
      assert.ok(
        preflight().some((r) => r[0] === "problem" && /internal\.refund_needs_approval/.test(r[1]))
      );
      q(original);
      assert.equal(fingerprint(), before);
    }
  );

  // ------------------------------------------------------------- apply
  const before = fingerprint();
  applySteps(database, [step]);
  const after = fingerprint();

  await check("apply, roll back and apply again are clean", () => {
    assert.notEqual(after, before);
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], /^ozow api refunds: already applied; .*not settled: 0$/);
    applySteps(database, [{ label: "ozow api refunds rollback", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before, "the rollback leaves the pre-update schema");
    assert.match(preflight()[0][1], /: update not applied /);
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
  });

  await check(
    "only staff call the staff commands and only the server reports Ozow's answers",
    () => {
      for (const sig of STAFF_COMMANDS) assert.deepEqual(callers(sig), ["authenticated"], sig);
      for (const sig of SERVICE_COMMANDS) assert.deepEqual(callers(sig), ["service_role"], sig);
      const buyer = verified("ozow-grants");
      const pay = buy(buyer, PLANS.days30, 1);
      // A member (even the buyer) and a moderator cannot refund, claim or report.
      fails(request(buyer, pay.id), "42501");
      fails(request(moderator, pay.id), "42501", /capability not granted/);
      fails(member(buyer, `select api.claim_ozow_refund_send('${randomUUID()}');`), "42501");
      fails(staff(admin, `select api.apply_ozow_refund_status('{}'::jsonb);`), "42501");
      fails("set role anon;\nselect api.reconcile_ozow_refunds('[]'::jsonb);", "42501");
      // A payment of the staff member's own identity.
      const own = buy(admin, PLANS.days30, 1);
      fails(request(admin, own.id), "42501", /different staff member/);
      // A payment not paid through Ozow (no Ozow transaction id).
      const other = buy(verified("ozow-not-ozow"), PLANS.days30, 1, `tx-${randomUUID()}`);
      fails(request(admin, other.id), "PT409", /not paid through Ozow/);
    }
  );

  await check("today's reference refunds are unchanged", () => {
    const pay = buy(verified("ozow-manual"), PLANS.days30, 1);
    const done = json(
      staff(
        admin,
        `select api.record_staff_payment_refund('${pay.id}','refunded','duplicate','Paid twice by mistake','OZ-MANUAL-1');`
      )
    );
    assert.equal(done.status, "applied");
    assert.equal(record(done.request_id).channel, "manual");
    assert.equal(payStatus(pay.id), "refunded");
  });

  let smallRefund;
  await check(
    "a refund at or below R1,000 is approved, not reversed, and handed to the sender once",
    () => {
      const pay = buy(verified("ozow-small"), PLANS.days30, 1);
      const first = json(request(admin, pay.id));
      assert.equal(first.status, "approved");
      assert.equal(first.channel, "api");
      assert.equal(first.needs_approval, false);
      assert.equal(first.repeated, false);
      assert.equal(payStatus(pay.id), "complete", "nothing is reversed before Ozow confirms");
      assert.equal(activeSlots(pay.id), 1);
      // The same request again (a double click) returns the same record.
      const again = json(request(admin, pay.id));
      assert.equal(again.request_id, first.request_id);
      assert.equal(again.repeated, true);
      // No second refund, no reference refund and no other reversal while it is in flight.
      fails(
        request(admin2, pay.id, null, "Another refund attempt"),
        "PT409",
        /on its way through Ozow/
      );
      fails(
        staff(
          admin2,
          `select api.record_staff_payment_refund('${pay.id}','refunded','duplicate','Paid twice by mistake','OZ-INFLIGHT-1');`
        ),
        "PT409"
      );
      fails(
        service(`select api.reverse_payment('${pay.id}','chargeback','Bank chargeback');`),
        "PT409"
      );
      // Handed to the sender once: a second claim, concurrent or later, gets nothing.
      const claimed = claim(first.request_id);
      assert.equal(claimed.claimed, true);
      assert.equal(claimed.attempt, 1);
      assert.equal(claimed.idempotency_key, `vm-refund-${first.request_id}`);
      assert.equal(claimed.transaction_id, pay.tx);
      assert.equal(claimed.amount_cents, pay.cents);
      assert.equal(claim(first.request_id).claimed, false);
      assert.equal(record(first.request_id).status, "sent");
      smallRefund = { pay, request: first.request_id, claimed };
    }
  );

  await check("only Complete reverses, once; a later Returned alerts staff", () => {
    const { pay, request: id, claimed } = smallRefund;
    const pending = fact(claimed, "Pending");
    const accepted = sendResult(id, { outcome: "accepted", ...pending });
    assert.equal(accepted.status, "sent");
    assert.equal(accepted.ozow_refund_id, pending.refund_id);
    assert.equal(payStatus(pay.id), "complete");
    // Submitted: still nothing changes.
    assert.equal(ozowStatus({ ...pending, status: "Submitted" }).outcome, "pending");
    assert.equal(payStatus(pay.id), "complete");
    const done = ozowStatus({
      ...pending,
      status: "Complete",
      completed_at: new Date().toISOString(),
    });
    assert.equal(done.outcome, "applied");
    assert.equal(record(id).status, "applied");
    assert.equal(payStatus(pay.id), "refunded");
    assert.equal(activeSlots(pay.id), 0);
    assert.equal(
      q(`select actor_id from private.frontend_payment_reversals where payment_id='${pay.id}';`),
      admin.id,
      "audited as the staff member who recorded it"
    );
    // A repeated notice changes nothing.
    assert.equal(ozowStatus({ ...pending, status: "Complete" }).outcome, "unchanged");
    assert.equal(
      q(`select count(*) from private.frontend_payment_reversals where payment_id='${pay.id}';`),
      "1"
    );
    // Returned after completion: the record stays applied, staff are alerted.
    assert.equal(ozowStatus({ ...pending, status: "Returned" }).outcome, "flagged");
    assert.equal(record(id).status, "applied");
    assert.deepEqual(problem(pay.id, "refund_returned"), {
      alert: true,
      source: "refund_notice",
      n: 1,
    });
  });

  await check("one slot through Ozow reverses only that slot", () => {
    const pay = buy(verified("ozow-slot"), PLANS.days30, 3);
    const [a, b, c] = lines(pay.id);
    const asked = json(request(admin, pay.id, a.id));
    assert.equal(asked.status, "approved");
    assert.equal(asked.line_id, a.id);
    assert.equal(asked.amount_cents, a.cents);
    const claimed = claim(asked.request_id);
    const complete = fact(claimed, "Complete");
    assert.equal(
      sendResult(asked.request_id, { outcome: "accepted", ...complete }).outcome,
      "applied"
    );
    assert.deepEqual(
      lines(pay.id).map((l) => l.status),
      ["reversed", "open", "open"]
    );
    assert.equal(payStatus(pay.id), "complete");
    assert.equal(q(`select reversed_by from private.payment_lines where id='${a.id}';`), admin.id);
    assert.ok(b.id && c.id);
    // A whole-payment refund after a slot refund is refused.
    fails(request(admin, pay.id), "PT409", /refund its other slots one by one/);
  });

  await check(
    "above R1,000 a second staff member approves; nothing is sent before or after a decline",
    () => {
      const pay = buy(verified("ozow-big"), PLANS.days180, 3);
      const waiting = json(request(admin, pay.id));
      assert.equal(waiting.status, "awaiting_approval");
      assert.equal(waiting.needs_approval, true);
      // Waiting: the sender gets nothing, and it is not due.
      assert.equal(claim(waiting.request_id).claimed, false);
      assert.ok(
        !json(service("select api.list_ozow_refund_sends_due(20);")).includes(waiting.request_id)
      );
      // The requester cannot approve their own refund.
      fails(
        staff(admin, `select api.approve_staff_payment_refund('${waiting.request_id}');`),
        "42501",
        /different staff member/
      );
      // Declined: never sent.
      const declined = json(
        staff(
          admin2,
          `select api.decline_staff_payment_refund('${waiting.request_id}','Customer withdrew request');`
        )
      );
      assert.equal(declined.status, "declined");
      assert.equal(claim(waiting.request_id).claimed, false);
      assert.equal(record(waiting.request_id).sent_at, null);
      // Recorded again and approved by the other admin: approved, not reversed.
      const again = json(request(admin, pay.id, null, "Cancelled within 14 days again"));
      const approved = json(
        staff(admin2, `select api.approve_staff_payment_refund('${again.request_id}');`)
      );
      assert.equal(approved.status, "approved");
      assert.equal(payStatus(pay.id), "complete");
      const repeat = json(
        staff(admin2, `select api.approve_staff_payment_refund('${again.request_id}');`)
      );
      assert.equal(repeat.repeated, true);
      assert.equal(record(again.request_id).approved_by, admin2.id);
      // Ozow refuses the first send (for example an empty float): failed, alerted.
      const claimed = claim(again.request_id);
      assert.equal(claimed.claimed, true);
      const refused = sendResult(again.request_id, {
        outcome: "refused",
        failure_reason: "ozow_refused",
      });
      assert.equal(refused.status, "failed");
      assert.equal(payStatus(pay.id), "complete");
      assert.deepEqual(problem(pay.id, "refund_failed"), {
        alert: true,
        source: "refund_send",
        n: 1,
      });
      // A failed refund returned nothing: staff may refund again.
      assert.equal(
        json(request(admin, pay.id, null, "Refund again after float top-up")).status,
        "awaiting_approval"
      );
    }
  );

  await check(
    "an unknown send is retried with the same key at most twice more, then alerts staff",
    () => {
      const pay = buy(verified("ozow-unknown"), PLANS.days30, 1);
      const asked = json(request(admin, pay.id));
      const first = claim(asked.request_id);
      assert.equal(sendResult(asked.request_id, { outcome: "unknown" }).status, "sent");
      assert.equal(claim(asked.request_id).claimed, false, "not again within five minutes");
      backdate(asked.request_id, "last_send_at", "6 minutes");
      assert.ok(
        json(service("select api.list_ozow_refund_sends_due(20);")).includes(asked.request_id)
      );
      const second = claim(asked.request_id);
      assert.equal(second.claimed, true);
      assert.equal(second.attempt, 2);
      assert.equal(second.idempotency_key, first.idempotency_key, "the same Idempotency-Key");
      // A refused retry proves nothing about the first send: no failure, alert.
      assert.equal(
        sendResult(asked.request_id, { outcome: "refused", failure_reason: "ozow_refused" })
          .outcome,
        "stuck"
      );
      assert.equal(record(asked.request_id).status, "sent");
      assert.equal(problem(pay.id, "refund_stuck").alert, true);
      backdate(asked.request_id, "last_send_at", "6 minutes");
      assert.equal(claim(asked.request_id).claimed, false, "no more retries");
      // Ozow's notice for that refund still links and settles it.
      const complete = fact(first, "Complete");
      const applied = ozowStatus(complete);
      assert.equal(applied.outcome, "applied");
      assert.equal(record(asked.request_id).ozow_refund_id, complete.refund_id);
      assert.equal(payStatus(pay.id), "refunded");
    }
  );

  await check(
    "Ozow refunds without a record, or that differ, alert staff; failures are final",
    () => {
      const pay = buy(verified("ozow-alerts"), PLANS.days30, 1);
      // A refund made in the Ozow dashboard that nobody recorded.
      const stray = {
        refund_id: randomUUID(),
        transaction_id: pay.tx,
        amount_cents: pay.cents,
        status: "Complete",
        requested_at: new Date().toISOString(),
        completed_at: null,
      };
      assert.equal(ozowStatus(stray).outcome, "unmatched");
      assert.deepEqual(problem(pay.id, "refund_unmatched"), {
        alert: true,
        source: "refund_notice",
        n: 1,
      });
      assert.equal(payStatus(pay.id), "complete", "an unmatched refund changes no payment");
      // A record whose Ozow refund reports another amount.
      const asked = json(request(admin, pay.id));
      const claimed = claim(asked.request_id);
      const pending = fact(claimed, "Pending");
      sendResult(asked.request_id, { outcome: "accepted", ...pending });
      assert.equal(
        ozowStatus({ ...pending, amount_cents: pay.cents - 100, status: "Complete" }).outcome,
        "mismatch"
      );
      assert.equal(payStatus(pay.id), "complete");
      // Failed at Ozow: failed, alerted, never reversed; a later Complete only alerts.
      assert.equal(ozowStatus({ ...pending, status: "Failed" }).outcome, "failed");
      assert.equal(record(asked.request_id).failure_reason, "ozow_failed");
      assert.equal(ozowStatus({ ...pending, status: "Complete" }).outcome, "flagged");
      assert.equal(payStatus(pay.id), "complete");
      assert.equal(problem(pay.id, "refund_mismatch").alert, true);
      // Malformed facts are refused.
      fails(
        service(
          `select api.apply_ozow_refund_status(${literal({ ...pending, status: "Done", source: "refund_notice" })});`
        ),
        "22023"
      );
      fails(
        service(
          `select api.apply_ozow_refund_status(${literal({ ...pending, amount_cents: "100", source: "refund_notice" })});`
        ),
        "22023"
      );
    }
  );

  await check("the daily check changes no refund and alerts unmatched and stuck refunds", () => {
    const pay = buy(verified("ozow-check"), PLANS.days30, 1);
    const asked = json(request(admin, pay.id));
    claim(asked.request_id);
    backdate(asked.request_id, "sent_at", "25 hours");
    const records = q(
      "select md5(string_agg(to_jsonb(r)::text, ',' order by r.id)) from private.payment_refund_requests r;"
    );
    const result = json(
      service(
        `select api.reconcile_ozow_refunds(${literal([
          {
            refund_id: randomUUID(),
            transaction_id: randomUUID(),
            amount_cents: 6900,
            status: "Complete",
            requested_at: new Date().toISOString(),
            completed_at: null,
          },
        ])});`
      )
    );
    assert.equal(result.checked, 1);
    assert.equal(result.unmatched, 1);
    assert.ok(result.stuck >= 1);
    assert.equal(problem(pay.id, "refund_stuck").alert, true);
    assert.equal(problem(null, "refund_unmatched").alert, false, "no payment: daily summary only");
    assert.equal(
      q(
        "select md5(string_agg(to_jsonb(r)::text, ',' order by r.id)) from private.payment_refund_requests r;"
      ),
      records,
      "no refund record changed"
    );
    fails(service(`select api.reconcile_ozow_refunds('{}'::jsonb);`), "22023");
  });

  await check(
    "an admin records a refund made in the Ozow dashboard with Ozow's refund id, once",
    () => {
      const pay = buy(verified("ozow-dashboard"), PLANS.days30, 1);
      const refundId = randomUUID();
      const done = json(dashboard(admin, pay.id, refundId));
      assert.equal(done.status, "applied");
      assert.equal(done.channel, "dashboard");
      assert.equal(record(done.request_id).ozow_reference, `${refundId}:${done.request_id}`);
      assert.equal(record(done.request_id).ozow_refund_id, refundId);
      assert.equal(payStatus(pay.id), "refunded");
      assert.equal(json(dashboard(admin, pay.id, refundId)).repeated, true);
      const other = buy(verified("ozow-dashboard-2"), PLANS.days30, 1);
      fails(dashboard(admin, other.id, refundId), "PT409", /already recorded/);
      fails(
        staff(
          admin,
          `select api.record_staff_dashboard_refund('${other.id}',null,'billing_error','Refunded by hand',null);`
        ),
        "22023"
      );
      // Ozow's notice for it is matched; a later failure alerts staff.
      const known = {
        refund_id: refundId,
        transaction_id: pay.tx,
        amount_cents: pay.cents,
        status: "Failed",
        requested_at: null,
        completed_at: null,
      };
      assert.equal(ozowStatus(known).outcome, "flagged");
      assert.equal(problem(pay.id, "refund_failed").alert, true);
      // Above R1,000 it waits for a second staff member, then takes effect.
      const big = buy(verified("ozow-dashboard-big"), PLANS.days180, 3);
      const waiting = json(dashboard(admin, big.id, randomUUID()));
      assert.equal(waiting.status, "awaiting_approval");
      assert.equal(payStatus(big.id), "complete");
      const approved = json(
        staff(admin2, `select api.approve_staff_payment_refund('${waiting.request_id}');`)
      );
      assert.equal(approved.status, "applied");
      assert.equal(payStatus(big.id), "refunded");
      // A declined record took no effect: its refund id can be recorded again
      // (here on the right payment), and a later read clears "missing".
      const wrong = buy(verified("ozow-dashboard-wrong"), PLANS.days180, 3);
      const right = buy(verified("ozow-dashboard-right"), PLANS.days180, 3);
      const reused = randomUUID();
      const first = json(dashboard(admin, wrong.id, reused));
      json(service(`select api.report_ozow_refund_missing('${first.request_id}');`));
      assert.ok(record(first.request_id).ozow_missing_at);
      json(
        staff(
          admin2,
          `select api.decline_staff_payment_refund('${first.request_id}','Recorded on the wrong payment');`
        )
      );
      const again = json(dashboard(admin, right.id, reused));
      assert.equal(again.status, "awaiting_approval");
      json(service(`select api.report_ozow_refund_missing('${again.request_id}');`));
      fails(
        staff(admin2, `select api.approve_staff_payment_refund('${again.request_id}');`),
        "PT409",
        /no paid refund/
      );
      assert.equal(
        ozowStatus({
          refund_id: reused,
          transaction_id: right.tx,
          amount_cents: right.cents,
          status: "Complete",
          requested_at: null,
          completed_at: null,
        }).request_id,
        again.request_id,
        "Ozow's status goes to the record that may still take effect"
      );
      assert.equal(record(again.request_id).ozow_missing_at, null);
      assert.equal(
        json(staff(admin2, `select api.approve_staff_payment_refund('${again.request_id}');`))
          .status,
        "applied"
      );
    }
  );

  await check("a lost send links only to a later refund that is not recorded anywhere else", () => {
    const pay = buy(verified("ozow-link"), PLANS.days30, 1);
    const asked = json(request(admin, pay.id));
    const claimed = claim(asked.request_id);
    sendResult(asked.request_id, { outcome: "unknown" });
    // An older refund of the same transaction and amount (before the send).
    const older = {
      ...fact(claimed, "Complete"),
      requested_at: new Date(Date.now() - 86_400_000).toISOString(),
    };
    assert.equal(ozowStatus(older).outcome, "unmatched");
    // A refund Ozow gives no request time for never links either.
    assert.equal(
      ozowStatus({ ...fact(claimed, "Complete"), requested_at: null }).outcome,
      "unmatched"
    );
    assert.equal(record(asked.request_id).ozow_refund_id, null);
    assert.equal(payStatus(pay.id), "complete");
    // A final status is never replaced by a non-final one.
    const later = fact(claimed, "Failed");
    assert.equal(ozowStatus(later).outcome, "failed");
    assert.equal(ozowStatus({ ...later, status: "Pending" }).outcome, "unchanged");
    assert.equal(record(asked.request_id).ozow_status, "Failed");
  });

  await check("the 10-minute follow-up claims unsettled refunds and records missing ones", () => {
    const pay = buy(verified("ozow-follow"), PLANS.days30, 1);
    const asked = json(request(admin, pay.id));
    const claimed = claim(asked.request_id);
    sendResult(asked.request_id, { outcome: "accepted", ...fact(claimed, "Pending") });
    const ids = () =>
      json(service("select api.claim_ozow_refund_checks(20);")).map((item) => item.request_id);
    assert.ok(!ids().includes(asked.request_id), "not within ten minutes of the send");
    backdate(asked.request_id, "sent_at", "11 minutes");
    assert.ok(ids().includes(asked.request_id));
    assert.ok(!ids().includes(asked.request_id), "not again within 30 minutes");
    const missing = json(service(`select api.report_ozow_refund_missing('${asked.request_id}');`));
    assert.equal(missing.reported, true);
    assert.equal(problem(pay.id, "refund_mismatch").alert, true);
    assert.equal(record(asked.request_id).status, "sent", "nothing else changes");
    fails(member(admin, "select api.claim_ozow_refund_checks(1);"), "42501");
  });

  await check("only another staff member closes a refund that never reached Ozow", () => {
    const pay = buy(verified("ozow-close"), PLANS.days30, 1);
    const close = (who, id) =>
      staff(who, `select api.close_staff_ozow_refund('${id}','Ozow has no such refund');`);
    // Approved, never sent.
    const first = json(request(admin, pay.id));
    fails(close(admin, first.request_id), "42501", /different staff member/);
    const closed = json(close(admin2, first.request_id));
    assert.equal(closed.status, "failed");
    assert.equal(record(first.request_id).failure_reason, "closed_by_staff");
    assert.equal(json(close(admin2, first.request_id)).repeated, true);
    // A lost send: only after Ozow, read a day after the send, did not have it.
    const second = json(request(admin, pay.id, null, "Refund again after closing"));
    claim(second.request_id);
    sendResult(second.request_id, { outcome: "unknown" });
    fails(close(admin2, second.request_id), "PT409", /never reached Ozow/);
    backdate(second.request_id, "sent_at", "2 days");
    fails(close(admin2, second.request_id), "PT409", /never reached Ozow/);
    json(service(`select api.report_ozow_refund_missing('${second.request_id}');`));
    assert.equal(json(close(admin2, second.request_id)).status, "failed");
    assert.equal(payStatus(pay.id), "complete");
    // A refund Ozow answered can never be closed.
    const third = json(request(admin, pay.id, null, "Refund a third time"));
    const claimed = claim(third.request_id);
    sendResult(third.request_id, { outcome: "accepted", ...fact(claimed, "Pending") });
    fails(close(admin2, third.request_id), "PT409", /never reached Ozow/);
  });

  await check(
    "an unexplained Ozow refund blocks closing; a missing dashboard refund is never approved",
    () => {
      const pay = buy(verified("ozow-close-blocked"), PLANS.days30, 1);
      const asked = json(request(admin, pay.id));
      const claimed = claim(asked.request_id);
      sendResult(asked.request_id, { outcome: "unknown" });
      backdate(asked.request_id, "sent_at", "2 days");
      json(service(`select api.report_ozow_refund_missing('${asked.request_id}');`));
      // Ozow reports a refund of this transaction that matches nothing (here
      // one without a request time): it may be this send.
      assert.equal(
        ozowStatus({ ...fact(claimed, "Complete"), requested_at: null }).outcome,
        "unmatched"
      );
      fails(
        staff(
          admin2,
          `select api.close_staff_ozow_refund('${asked.request_id}','Ozow has no such refund');`
        ),
        "PT409",
        /never reached Ozow/
      );
      // A dashboard refund above R1,000 that Ozow does not have.
      const big = buy(verified("ozow-dashboard-missing"), PLANS.days180, 3);
      const waiting = json(dashboard(admin, big.id, randomUUID()));
      json(service(`select api.report_ozow_refund_missing('${waiting.request_id}');`));
      fails(
        staff(admin2, `select api.approve_staff_payment_refund('${waiting.request_id}');`),
        "PT409",
        /no paid refund/
      );
      assert.equal(payStatus(big.id), "complete");
      // The daily check flags a refund recorded as made that Ozow did not pay.
      const paid = buy(verified("ozow-dashboard-unpaid"), PLANS.days30, 1);
      const refundId = randomUUID();
      json(dashboard(admin, paid.id, refundId));
      const result = json(
        service(
          `select api.reconcile_ozow_refunds(${literal([
            {
              refund_id: refundId,
              transaction_id: paid.tx,
              amount_cents: paid.cents,
              status: "Failed",
              requested_at: null,
              completed_at: null,
            },
          ])});`
        )
      );
      assert.equal(result.mismatched, 1);
      assert.deepEqual(problem(paid.id, "refund_failed"), {
        alert: true,
        source: "refund_check",
        n: 1,
      });
    }
  );

  await check(
    "once refunds go through Ozow, a typed reference cannot refund an Ozow payment",
    () => {
      const pay = buy(verified("ozow-retired"), PLANS.days30, 1);
      const typed = randomUUID();
      fails(
        staff(
          admin,
          `select api.record_staff_payment_refund('${pay.id}','refunded','duplicate','Paid twice by mistake','OZ-RETIRED-1');`
        ),
        "PT409",
        /go through Ozow now/
      );
      assert.equal(payStatus(pay.id), "complete");
      // Chargebacks keep the reference; a reference may not reuse a recorded refund id.
      const recorded = q(
        "select ozow_refund_id from private.payment_refund_requests where ozow_refund_id is not null and status <> 'declined' limit 1;"
      );
      fails(
        staff(
          admin,
          `select api.record_staff_payment_refund('${pay.id}','chargeback','duplicate','Bank chargeback received','${recorded}');`
        ),
        "PT409",
        /already recorded/
      );
      assert.equal(
        json(
          staff(
            admin,
            `select api.record_staff_payment_refund('${pay.id}','chargeback','duplicate','Bank chargeback received','${typed}');`
          )
        ).status,
        "applied"
      );
      // A typed reference never explains away a refund of another payment.
      assert.equal(
        ozowStatus({
          refund_id: typed,
          transaction_id: randomUUID(),
          amount_cents: pay.cents,
          status: "Complete",
          requested_at: null,
          completed_at: null,
        }).outcome,
        "mismatch"
      );
      assert.equal(problem(pay.id, "refund_mismatch").alert, true);
    }
  );

  await check("the record guard keeps every fact and lets a record settle once", () => {
    const pay = buy(verified("ozow-guard"), PLANS.days30, 1);
    const asked = json(request(admin, pay.id));
    const tamper = (set) =>
      fails(
        `update private.payment_refund_requests set ${set} where id='${asked.request_id}';`,
        "23514"
      );
    tamper("amount_cents=100");
    tamper("ozow_transaction_id=gen_random_uuid()");
    tamper("status='applied', applied_at=now()");
    tamper("channel='manual'");
    const claimed = claim(asked.request_id);
    const pending = fact(claimed, "Pending");
    sendResult(asked.request_id, { outcome: "accepted", ...pending });
    tamper("ozow_refund_id=gen_random_uuid()");
    tamper("status='approved'");
    tamper("send_attempts=0");
    // An API record cannot be inserted already sent.
    fails(
      `insert into private.payment_refund_requests (payment_id, account_id, kind, reason_code, reason, ozow_reference,
        amount_cents, recorded_before_cents, needs_approval, status, requested_by, channel, ozow_transaction_id, approved_at)
       select p.id, p.owner_id, 'refunded', 'duplicate', 'Inserted directly', 'vm-refund-' || gen_random_uuid(), p.amount_cents, 0,
        false, 'approved', '${admin.id}', 'api', lower(p.provider_transaction_id)::uuid, now()
       from private.payments p where p.id='${pay.id}';`,
      "23514"
    );
    const view = json(
      staff(admin, `select api.get_staff_ozow_refunds(array['${pay.id}']::uuid[]);`)
    );
    assert.deepEqual(view.payments, [{ payment_id: pay.id, ozow_refundable: true }]);
    assert.equal(view.records.length, 1);
    assert.equal(view.records[0].status, "sent");
    assert.equal(view.records[0].requested_by_me, true);
    assert.ok(!("account_id" in view.records[0]));
    fails(
      staff(moderator, `select api.get_staff_ozow_refunds(array['${pay.id}']::uuid[]);`),
      "42501"
    );
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the refund commands", () => {
      for (const sig of SERVICE_COMMANDS) assert.deepEqual(callers(sig), ["service_role"], sig);
      for (const sig of STAFF_COMMANDS) assert.deepEqual(callers(sig), ["authenticated"], sig);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Ozow API refund checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
