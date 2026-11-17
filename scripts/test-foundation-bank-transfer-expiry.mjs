#!/usr/bin/env node
// Behaviour checks for 20261117141803_bank_transfer_expiry.sql: a recorded bank
// transfer still waiting for a second staff member 14 days after it was
// recorded expires (owner's decision of 16 November 2026).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Staff act with a verified authenticator app and an AAL2 session,
// members with synthetic sessions, the operation job's sweep as
// `service_role`. A transfer's age is set by moving its recorded time back
// (as the database owner, with triggers off); nothing else is written
// directly. The script checks the read-only preflight and the update's
// refusals, applies the update, proves apply -> rollback -> apply returns the
// schema fingerprint to the same values, then checks: a transfer waiting 13
// days stays waiting and one waiting 14 days or more expires (a transfer
// recorded before the update too); a rerun of the sweep changes nothing; an
// expired transfer, or one past 14 days the sweep has not reached, cannot be
// confirmed or declined; one younger than 14 days is confirmed as before; the
// record guard; an invoice whose transfer expired can be paid again and given
// a new transfer, and its member sees the expiry (only theirs); the bank credit
// can be recorded again; staff see expired transfers (and the waiting list
// leaves them out); the audit trail; the account erasure no longer waits; the
// grants; and that the rollback refuses once a transfer expired.
//
//   node --import tsx scripts/test-foundation-bank-transfer-expiry.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Members,
// staff and identity facts are written directly as the database owner. Nothing
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
  bankTransferCommands,
  createPaymentWorld,
  sqlValue,
  updateCheckKit,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261117141803_bank_transfer_expiry.sql";
const REVIEWED = {
  "internal.invoice_transfer_guard()": "494dcdb720573571dd36edf97b055332",
  "internal.confirm_staff_invoice_payment(uuid)": "e0c308df14f38f1de76bdced4e8683f2",
  "internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)":
    "594b47bc794e335a3f3be505a4b1637e",
  "internal.record_staff_invoice_transfer(text,text,text,boolean,text)":
    "171c0ad6f18a7f5329ff00dcfff4608d",
  "internal.invoice_transfer_dto(private.invoice_transfers,uuid)":
    "b91dbdd96bec847ddb165d6a663cc7cb",
  "internal.retention_commerce(integer)": "422a63c6d6fd2be5a1556893a8975d3f",
};
const NEW_API = [
  "api.expire_waiting_bank_transfers(integer)",
  "api.get_staff_expired_invoice_transfers()",
  "api.get_my_invoice_transfer_expiry(text)",
];

const started = Date.now();
const { check, current, passed: checks } = createChecks();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const kit = updateCheckKit(database, UPDATE, current);
  const { q, json, fails, member, staff, service, preflight, fingerprint, steps, index } = kit;
  const world = createPaymentWorld(kit);
  const admin = world.staffUser("expiry-admin", "admin");
  const admin2 = world.staffUser("expiry-admin2", "admin");
  world.review(admin, admin2, "expiry-admin");
  world.review(admin2, admin, "expiry-admin2");
  const verified = (label) => world.verified(label, admin);
  const today = q("select to_char((now() at time zone 'Africa/Johannesburg')::date,'YYYY-MM-DD');");
  const transfers = bankTransferCommands(kit, today);
  const bodyMd5 = (signature) =>
    q(
      `select coalesce((select md5(replace(prosrc,E'\\r\\n',E'\\n')) from pg_proc where oid=to_regprocedure('${signature}')),'missing');`
    );
  /** Moves a transfer's recorded time back by `interval` (triggers off). */
  const age = (id, interval) =>
    q(`set session_replication_role=replica;
      update private.invoice_transfers set recorded_at=statement_timestamp()-interval '${interval}' where id='${id}';
      set session_replication_role=origin;`);
  // expired_at is read through to_jsonb, so this also works before the update.
  const status = (id) =>
    json(`select jsonb_build_object('status',t.status,'expired',to_jsonb(t)->'expired_at' is not null
        and to_jsonb(t)->'expired_at'<>'null'::jsonb,'payment',t.payment_id is not null)
      from private.invoice_transfers t where t.id='${id}';`);
  const sweepSql = (limit = 100) => service(`select api.expire_waiting_bank_transfers(${limit});`);
  const sweep = (limit) => json(sweepSql(limit));
  /** A direct bank transfer (no invoice) of one 30-day slot for `owner`. */
  const recordDirect = (owner, reference) =>
    transfers.record(admin, { email: owner.email, term: 30, slots: 1, reference });

  // Customer invoices (P2b): issue, billing details, record a transfer to it.
  const issue = (owner) =>
    json(
      staff(
        admin,
        `select api.issue_staff_invoice(${sqlValue(owner.email)},30,1,7,'Invoice requested by email','${randomUUID()}');`
      )
    );
  const save = (owner, number) =>
    json(
      member(
        owner,
        `select api.save_my_invoice_billing(${sqlValue(number)},1,'Fixture Traders','1 Example Road, Empangeni',null);`
      )
    );
  const transferToInvoiceSql = (number, reference) =>
    staff(
      admin,
      `select api.record_staff_invoice_transfer(${sqlValue(number)},${sqlValue(reference)},'${today}',true,'EFT cleared; written waiver on file');`
    );
  const myInvoice = (owner, number) =>
    json(member(owner, `select api.get_my_invoice(${sqlValue(number)});`));
  const expirySql = (owner, number) =>
    member(owner, `select api.get_my_invoice_transfer_expiry(${sqlValue(number)});`);
  const payNowSql = (owner, number) =>
    member(owner, `select api.start_invoice_payment(${sqlValue(number)},6900,true);`);

  // ------------------------------------------------------------ before
  const early = verified("expiry-early");
  const earlyTransfer = recordDirect(early, "FNB EARLY 0020");
  age(earlyTransfer.transfer_id, "20 days");

  await check("before the update: a transfer waits however old it is", () => {
    for (const [signature, md5] of Object.entries(REVIEWED))
      assert.equal(bodyMd5(signature), md5, signature);
    assert.deepEqual(status(earlyTransfer.transfer_id), {
      status: "awaiting_confirmation",
      expired: false,
      payment: false,
    });
    fails(sweepSql(), "42883");
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
      "bank transfer expiry: update not applied; waiting: 1; waiting 14 days or more: 1; expired: 0"
    );
    assertReadOnlyPreflight(database, kit.preflightSql);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(kit.rollbackSql, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    for (const signature of Object.keys(REVIEWED)) {
      const live = q(`select pg_get_functiondef('${signature}'::regprocedure);`);
      q(
        `do $$begin execute replace(pg_get_functiondef('${signature}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
      );
      const rows = preflight();
      assert.equal(rows.length, 2, JSON.stringify(rows));
      assert.match(rows[0][1], /^bank transfer expiry: unexpected state;/);
      assert.ok(rows[1][1].startsWith(`${signature} is neither the reviewed body`), rows[1][1]);
      assert.match(fails(kit.step.sql, "55000"), /bank transfer expiry precondition/);
      q(`${live};`);
    }
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "bank transfer expiry",
    applied:
      /^bank transfer expiry: already applied; waiting: 1; waiting 14 days or more: 1; expired: 0$/,
    notApplied: /^bank transfer expiry: update not applied;/,
  });

  await check("the earlier transfer still waits until the sweep runs", () => {
    assert.equal(status(earlyTransfer.transfer_id).status, "awaiting_confirmation");
  });

  const thandi = verified("expiry-thandi");
  const sipho = verified("expiry-sipho");
  const lindiwe = verified("expiry-lindiwe");
  const t13 = recordDirect(thandi, "FNB DAY13 0001");
  const t14 = recordDirect(sipho, "FNB DAY14 0001");
  const fresh = recordDirect(lindiwe, "FNB FRESH 0001");
  age(t13.transfer_id, "13 days 23 hours 59 minutes");
  age(t14.transfer_id, "14 days 1 second");

  await check("13 days waiting stays waiting; 14 days or more expires", () => {
    assert.deepEqual(sweep(), { expired: 2, invoices_open_again: 0 });
    assert.deepEqual(status(t13.transfer_id), {
      status: "awaiting_confirmation",
      expired: false,
      payment: false,
    });
    assert.deepEqual(status(fresh.transfer_id).status, "awaiting_confirmation");
    for (const t of [t14, earlyTransfer])
      assert.deepEqual(status(t.transfer_id), { status: "expired", expired: true, payment: false });
    assert.match(
      preflight()[0][1],
      /^bank transfer expiry: already applied; waiting: 2; waiting 14 days or more: 0; expired: 2$/
    );
  });
  await check("a rerun of the sweep changes nothing more", () => {
    const at = q(`select expired_at from private.invoice_transfers where id='${t14.transfer_id}';`);
    assert.deepEqual(sweep(), { expired: 0, invoices_open_again: 0 });
    assert.equal(
      q(`select expired_at from private.invoice_transfers where id='${t14.transfer_id}';`),
      at
    );
    assert.equal(status(t14.transfer_id).status, "expired");
  });
  await check("the sweep's limit is bounded and each run takes the oldest first", () => {
    fails(sweepSql(0), "22023");
    fails(sweepSql(1001), "22023");
    fails(sweepSql("null"), "22023");
    const one = recordDirect(verified("expiry-limit-1"), "FNB LIMIT 0001");
    const two = recordDirect(verified("expiry-limit-2"), "FNB LIMIT 0002");
    age(one.transfer_id, "16 days");
    age(two.transfer_id, "15 days");
    assert.deepEqual(sweep(1), { expired: 1, invoices_open_again: 0 });
    assert.equal(status(one.transfer_id).status, "expired");
    assert.equal(status(two.transfer_id).status, "awaiting_confirmation");
    assert.deepEqual(sweep(1), { expired: 1, invoices_open_again: 0 });
    assert.equal(status(two.transfer_id).status, "expired");
  });
  await check("an expired transfer cannot be confirmed or declined", () => {
    assert.match(fails(transfers.confirmSql(admin2, t14.transfer_id), "PT409"), /already expired/);
    assert.match(fails(transfers.declineSql(admin2, t14.transfer_id), "PT409"), /already expired/);
    assert.deepEqual(status(t14.transfer_id), { status: "expired", expired: true, payment: false });
    assert.equal(
      Number(q(`select count(*) from private.payments where owner_id='${sipho.id}';`)),
      0,
      "no payment for the expired transfer"
    );
  });
  await check("past 14 days but not swept yet: never confirmed, still declinable", () => {
    const late = recordDirect(verified("expiry-late"), "FNB LATE 0001");
    age(late.transfer_id, "14 days 5 minutes");
    const error = fails(transfers.confirmSql(admin2, late.transfer_id), "PT409");
    assert.match(error, /waited 14 days without confirmation and expired/);
    assert.match(error, /transfer_not_waiting/);
    assert.equal(status(late.transfer_id).status, "awaiting_confirmation");
    const declined = json(transfers.declineSql(admin2, late.transfer_id));
    assert.equal(declined.status, "declined");
    assert.deepEqual(sweep(), { expired: 0, invoices_open_again: 0 });
  });
  await check("a transfer younger than 14 days is confirmed as before", () => {
    const confirmed = transfers.confirm(admin2, t13.transfer_id);
    assert.equal(confirmed.status, "confirmed");
    assert.deepEqual(status(t13.transfer_id), {
      status: "confirmed",
      expired: false,
      payment: true,
    });
    // A confirmed transfer is never expired, however old it gets.
    q(`set session_replication_role=replica;
      update private.invoice_transfers set recorded_at=now()-interval '40 days' where id='${t13.transfer_id}';
      set session_replication_role=origin;`);
    assert.deepEqual(sweep(), { expired: 0, invoices_open_again: 0 });
    assert.equal(status(t13.transfer_id).status, "confirmed");
  });
  await check("the record guard: expiry only after 14 days, once, with nothing else", () => {
    fails(
      `update private.invoice_transfers set status='expired',expired_at=statement_timestamp() where id='${fresh.transfer_id}';`,
      "23514",
      /expires only 14 days after it was recorded/
    );
    age(fresh.transfer_id, "15 days");
    fails(
      `update private.invoice_transfers set status='expired',expired_at=statement_timestamp(),reason='Changed with the expiry' where id='${fresh.transfer_id}';`,
      "23514"
    );
    fails(
      `update private.invoice_transfers set status='expired',expired_at=statement_timestamp()+interval '1 hour' where id='${fresh.transfer_id}';`,
      "23514"
    );
    fails(
      `update private.invoice_transfers set expired_at=statement_timestamp() where id='${fresh.transfer_id}';`,
      "23514"
    );
    fails(
      `update private.invoice_transfers set status='awaiting_confirmation',expired_at=null where id='${t14.transfer_id}';`,
      "23514"
    );
    fails(
      `update private.invoice_transfers set expired_at=statement_timestamp() where id='${t14.transfer_id}';`,
      "23514"
    );
    fails(`delete from private.invoice_transfers where id='${t14.transfer_id}';`, "23514");
    fails(
      `insert into private.invoice_transfers(account_id,plan_version_id,slots,amount_received_cents,bank_reference,
          cleared_on,cooling_off_waiver_confirmed,reason,recorded_by,status,expired_at)
        select account_id,plan_version_id,1,amount_received_cents,'FNB INSERT 0001',cleared_on,true,reason,recorded_by,
          'expired',statement_timestamp() from private.invoice_transfers where id='${t14.transfer_id}';`,
      "23514"
    );
    // The constraint keeps status and time together even with triggers off.
    fails(
      `set session_replication_role=replica;
       update private.invoice_transfers set status='expired' where id='${fresh.transfer_id}';`,
      "23514"
    );
    assert.deepEqual(sweep(), { expired: 1, invoices_open_again: 0 });
    assert.equal(status(fresh.transfer_id).status, "expired");
  });
  await check("the bank credit of an expired transfer can be recorded again", () => {
    const again = recordDirect(sipho, "FNB DAY14 0001");
    assert.equal(again.status, "awaiting_confirmation");
    assert.notEqual(again.transfer_id, t14.transfer_id);
    assert.equal(again.similar_records, 0, "an expired record is not a possible duplicate");
    assert.equal(transfers.confirm(admin2, again.transfer_id).status, "confirmed");
  });

  // ---------------------------------------------------- customer invoices
  const buyer = verified("expiry-buyer");
  const stranger = verified("expiry-stranger");
  const invoice = issue(buyer);
  const number = invoice.invoice_number;
  save(buyer, number);
  const toInvoice = json(transferToInvoiceSql(number, "FNB INVOICE 0001"));

  await check("while a transfer to an invoice waits, the invoice waits too", () => {
    assert.equal(myInvoice(buyer, number).transfer_waiting, true);
    assert.deepEqual(json(expirySql(buyer, number)), {
      invoice_number: number,
      transfer_expired_at: null,
    });
    fails(payNowSql(buyer, number), "PT409", /invoice_transfer_waiting/);
    assert.equal(q(`select internal.account_erasure_hold('${buyer.id}');`), "transfer_waiting");
  });
  await check("after 14 days the invoice is payable again and its member sees the expiry", () => {
    age(toInvoice.transfer_id, "14 days 10 minutes");
    assert.deepEqual(sweep(), { expired: 1, invoices_open_again: 1 });
    const read = myInvoice(buyer, number);
    assert.equal(read.status, "issued");
    assert.equal(read.transfer_waiting, false);
    const expiry = json(expirySql(buyer, number));
    assert.equal(expiry.invoice_number, number);
    assert.equal(
      expiry.transfer_expired_at,
      json(
        `select to_jsonb(expired_at) from private.invoice_transfers where id='${toInvoice.transfer_id}';`
      )
    );
    assert.notEqual(
      q(`select coalesce(internal.account_erasure_hold('${buyer.id}'),'none');`),
      "transfer_waiting"
    );
    // Only the invoice's own member: anyone else reads it as not found.
    fails(expirySql(stranger, number), "PT404", /invoice_unavailable/);
    fails(expirySql(buyer, "VM-1999-000001"), "PT404");
    fails(expirySql(buyer, "../admin"), "PT404");
    const pay = json(payNowSql(buyer, number));
    assert.equal(pay.status, "pending");
  });
  await check("staff can record the transfer to the invoice again; the notice then goes", () => {
    const again = json(transferToInvoiceSql(number, "FNB INVOICE 0001"));
    assert.equal(again.status, "awaiting_confirmation");
    assert.equal(myInvoice(buyer, number).transfer_waiting, true);
    assert.equal(json(expirySql(buyer, number)).transfer_expired_at, null);
    // Declined (as before, members are not shown a decline): no notice.
    json(transfers.declineSql(admin2, again.transfer_id));
    assert.equal(json(expirySql(buyer, number)).transfer_expired_at, null);
    assert.equal(myInvoice(buyer, number).transfer_waiting, false);
  });
  await check("a paid invoice shows no expiry", () => {
    const paid = issue(stranger);
    save(stranger, paid.invoice_number);
    const first = json(transferToInvoiceSql(paid.invoice_number, "FNB PAID 0001"));
    age(first.transfer_id, "20 days");
    sweep();
    const second = json(transferToInvoiceSql(paid.invoice_number, "FNB PAID 0002"));
    assert.ok(json(expirySql(stranger, paid.invoice_number)).transfer_expired_at === null);
    transfers.confirm(admin2, second.transfer_id);
    assert.equal(myInvoice(stranger, paid.invoice_number).status, "paid");
    assert.deepEqual(json(expirySql(stranger, paid.invoice_number)), {
      invoice_number: paid.invoice_number,
      transfer_expired_at: null,
    });
  });

  // --------------------------------------------------- staff visibility
  await check("staff see expired transfers; the waiting list leaves them out", () => {
    const expired = json(staff(admin2, "select api.get_staff_expired_invoice_transfers();")).items;
    const ids = expired.map((t) => t.transfer_id);
    for (const t of [t14, earlyTransfer, toInvoice]) assert.ok(ids.includes(t.transfer_id));
    const item = expired.find((t) => t.transfer_id === toInvoice.transfer_id);
    assert.equal(item.status, "expired");
    assert.equal(item.invoice_number, number);
    assert.match(item.expired_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(expired.find((t) => t.transfer_id === t14.transfer_id).invoice_number, null);
    // Newest first, at most 20.
    const times = expired.map((t) => Date.parse(t.expired_at));
    assert.deepEqual(
      times,
      [...times].sort((a, b) => b - a)
    );
    assert.ok(expired.length <= 20);
    const waiting = json(staff(admin2, "select api.get_staff_invoice_transfers();"));
    assert.ok(waiting.items.every((t) => t.status === "awaiting_confirmation"));
    assert.ok(!waiting.items.some((t) => ids.includes(t.transfer_id)));
    // Members and expired staff sessions are refused.
    fails(member(buyer, "select api.get_staff_expired_invoice_transfers();"), "42501");
    fails(
      staff(
        admin2,
        "select api.get_staff_expired_invoice_transfers();",
        Math.floor(Date.now() / 1000) - 13 * 3600
      ),
      "42501"
    );
    // Older than 30 days: no longer listed.
    q(`set session_replication_role=replica;
      update private.invoice_transfers set expired_at=now()-interval '31 days',recorded_at=now()-interval '45 days'
        where id='${earlyTransfer.transfer_id}';
      set session_replication_role=origin;`);
    assert.ok(
      !json(staff(admin2, "select api.get_staff_expired_invoice_transfers();")).items.some(
        (t) => t.transfer_id === earlyTransfer.transfer_id
      )
    );
  });
  await check("the audit trail lists each expiry with no staff member", () => {
    const rows =
      json(`select coalesce(jsonb_agg(jsonb_build_object('actor',actor_id,'reason',reason)),'[]')
        from private.frontend_staff_audit_events
        where action='payment:invoice_expired' and target_id='${t14.transfer_id}';`);
    assert.deepEqual(rows, [
      {
        actor: null,
        reason:
          "Bank transfer FNB DAY14 0001 expired: not confirmed within 14 days of being recorded",
      },
    ]);
    const page = json(
      staff(
        admin2,
        `select api.get_frontend_staff_audit_page('{"action":"payment_invoice_expired"}'::jsonb);`
      )
    );
    assert.ok(page.items.length >= 4);
    assert.ok(
      page.items.every((i) => i.action === "payment_invoice_expired" && i.actor_id === null)
    );
  });
  await check("who may run the new commands", () => {
    assert.deepEqual(executeGrants(json, NEW_API), {
      "api.expire_waiting_bank_transfers(integer)": {
        anon: false,
        authenticated: false,
        service_role: true,
      },
      "api.get_staff_expired_invoice_transfers()": {
        anon: false,
        authenticated: true,
        service_role: false,
      },
      "api.get_my_invoice_transfer_expiry(text)": {
        anon: false,
        authenticated: true,
        service_role: false,
      },
    });
    fails(member(buyer, "select api.expire_waiting_bank_transfers(100);"), "42501");
    fails(staff(admin2, "select api.expire_waiting_bank_transfers(100);"), "42501");
    assert.equal(
      executeGrants(json, ["internal.invoice_transfer_expires_after()"])[
        "internal.invoice_transfer_expires_after()"
      ].authenticated,
      false
    );
  });
  await check("the rollback refuses once a transfer has expired", () => {
    const before = fingerprint();
    assert.match(fails(kit.rollbackSql, "55000"), /bank transfers have expired/);
    assert.equal(fingerprint(), before);
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the 14-day expiry", () => {
      const last = recordDirect(verified("expiry-later"), "FNB LATER 0001");
      age(last.transfer_id, "14 days 1 minute");
      assert.equal(sweep().expired, 1);
      assert.equal(status(last.transfer_id).status, "expired");
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Bank transfer expiry checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
