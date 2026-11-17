#!/usr/bin/env node
// Behaviour checks for 20261117141803_bank_transfer_expiry.sql: a recorded bank
// transfer still waiting for a second staff member 14 days after it was
// recorded has expired (owner's decision of 16 November 2026).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Staff act with a verified authenticator app and an AAL2 session,
// members with synthetic sessions, the operation job's sweep as
// `service_role`. A transfer's age (and, for one check, the date its money
// cleared) is set as the database owner with triggers off; nothing else is
// written directly. The script checks the read-only preflight (which lists
// transfers waiting 14 days or more) and the update's refusals, applies the
// update, proves apply -> rollback -> apply returns the schema fingerprint to
// the same values, then checks: one rule, so a transfer that has waited 14
// days counts as expired before the sweep marks it (never confirmed or
// declined, its invoice payable, the account's erasure not held, listed for
// staff and shown to its member); 13 days still waits; the sweep marks it, a
// rerun changes nothing, the limit holds and one row that cannot be changed
// does not stop the others; the record guard; the bank credit can be recorded
// again, also when it cleared more than 90 days ago, but never counted twice;
// the invoice takes a new transfer; staff see each expired transfer until it
// is followed up; the audit trail; the privacy export; the grants; and that
// the rollback refuses once a transfer was marked expired.
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
  "internal.decline_staff_invoice_payment(uuid,text)": "cc8641faee31c5a9a043e4c510d26302",
  "internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)":
    "594b47bc794e335a3f3be505a4b1637e",
  "internal.record_staff_invoice_transfer(text,text,text,boolean,text)":
    "171c0ad6f18a7f5329ff00dcfff4608d",
  "internal.invoice_transfer_dto(private.invoice_transfers,uuid)":
    "b91dbdd96bec847ddb165d6a663cc7cb",
  "internal.get_staff_invoice_transfers()": "37ec35ae8968df035025e3c69234f3be",
  "internal.customer_invoice_dto(private.customer_invoices,uuid)":
    "5ce8a88fc44ed9e59a1cfd7dd6214382",
  "internal.start_invoice_payment(text,bigint,boolean)": "58e3e24aa91f41a476435c8b152b94d2",
  "internal.void_staff_invoice(uuid,text)": "21763bcb62e398b6d1b8e8d64ef38ea5",
  "internal.account_erasure_hold(uuid)": "5bd01c33cf23f3e6516ceb96c3dc3236",
  "internal.retention_commerce(integer)": "422a63c6d6fd2be5a1556893a8975d3f",
  "internal.frontend_privacy_export_data(uuid)": "1a16274c11f77a9a6d72482ca43d6753",
};
const NEW_API = [
  "api.expire_waiting_bank_transfers(integer)",
  "api.get_staff_expired_invoice_transfers()",
  "api.get_my_invoice_transfer_expiry(text)",
  "api.resolve_expired_invoice_transfer(uuid,text,text)",
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
  const daysAgo = (n) =>
    q(`select to_char((now() at time zone 'Africa/Johannesburg')::date - ${n},'YYYY-MM-DD');`);
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
  const sweepSql = (limit = 50) => service(`select api.expire_waiting_bank_transfers(${limit});`);
  const sweep = (limit) => json(sweepSql(limit));
  const swept = (expired, withInvoice = 0, failures = []) => ({
    expired,
    with_invoice: withInvoice,
    failed: failures.length,
    failures,
  });
  const resolveSql = (
    who,
    id,
    resolution = "never_arrived",
    reason = "No credit on the statement"
  ) =>
    staff(
      who,
      `select api.resolve_expired_invoice_transfer('${id}',${sqlValue(resolution)},${sqlValue(reason)});`
    );
  /** A direct bank transfer (no invoice) of one 30-day slot for `owner`. */
  const recordDirect = (owner, reference, cleared = today) =>
    transfers.record(admin, { email: owner.email, term: 30, slots: 1, reference, cleared });
  const staffExpired = () =>
    json(staff(admin2, "select api.get_staff_expired_invoice_transfers();"));
  const staffWaiting = () => json(staff(admin2, "select api.get_staff_invoice_transfers();"));
  const listedExpired = (id) => staffExpired().items.find((t) => t.transfer_id === id);

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
  const transferToInvoiceSql = (number, reference, cleared = today) =>
    staff(
      admin,
      `select api.record_staff_invoice_transfer(${sqlValue(number)},${sqlValue(reference)},'${cleared}',true,'EFT cleared; written waiver on file');`
    );
  const myInvoice = (owner, number) =>
    json(member(owner, `select api.get_my_invoice(${sqlValue(number)});`));
  const expirySql = (owner, number) =>
    member(owner, `select api.get_my_invoice_transfer_expiry(${sqlValue(number)});`);
  const payNowSql = (owner, number) =>
    member(owner, `select api.start_invoice_payment(${sqlValue(number)},6900,true);`);
  const voidSql = (invoiceId) =>
    staff(admin, `select api.void_staff_invoice('${invoiceId}','Issued for the wrong term');`);

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
  await check("preflight: read only; lists each transfer waiting 14 days or more", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary", "problem"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      "bank transfer expiry: update not applied; waiting: 1; waiting 14 days or more: 1; expired: 0"
    );
    assert.match(
      rows[1][1],
      new RegExp(
        `^bank transfer ${earlyTransfer.transfer_id} \\(FNB EARLY 0020, 6900 cents\\) recorded \\d{4}-\\d{2}-\\d{2} has waited 14 days or more: confirm or decline it before applying the update$`
      )
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
      assert.equal(rows.length, 3, JSON.stringify(rows));
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

  await check("one rule: 14 days waiting is expired before the sweep marks it", () => {
    assert.equal(status(earlyTransfer.transfer_id).status, "awaiting_confirmation");
    for (const sql of [
      transfers.confirmSql(admin2, earlyTransfer.transfer_id),
      transfers.declineSql(admin2, earlyTransfer.transfer_id),
    ])
      assert.match(
        fails(sql, "PT409"),
        /waited 14 days without confirmation and expired[\s\S]*transfer_not_waiting/
      );
    assert.ok(!staffWaiting().items.some((t) => t.transfer_id === earlyTransfer.transfer_id));
    const listed = listedExpired(earlyTransfer.transfer_id);
    assert.equal(listed.status, "expired");
    assert.equal(listed.invoice_number, null);
    assert.equal(
      Date.parse(listed.expired_at),
      Date.parse(
        json(
          `select to_jsonb(recorded_at+interval '14 days') from private.invoice_transfers where id='${earlyTransfer.transfer_id}';`
        )
      )
    );
    // Even the record guard refuses deciding it (the commands are not the only path).
    fails(
      `update private.invoice_transfers set status='declined',declined_by='${admin2.id}',declined_at=now(),
        decline_reason='Declined after expiry' where id='${earlyTransfer.transfer_id}';`,
      "23514",
      /has expired and is never confirmed or declined/
    );
    assert.notEqual(
      q(`select coalesce(internal.account_erasure_hold('${early.id}'),'none');`),
      "transfer_waiting"
    );
  });

  const thandi = verified("expiry-thandi");
  const sipho = verified("expiry-sipho");
  const lindiwe = verified("expiry-lindiwe");
  const t13 = recordDirect(thandi, "FNB DAY13 0001");
  const t14 = recordDirect(sipho, "FNB DAY14 0001");
  const fresh = recordDirect(lindiwe, "FNB FRESH 0001");
  age(t13.transfer_id, "13 days 23 hours 59 minutes");
  age(t14.transfer_id, "14 days 1 second");

  await check("the sweep marks 14 days or more; 13 days stays waiting", () => {
    assert.deepEqual(sweep(), swept(2));
    assert.deepEqual(status(t13.transfer_id), {
      status: "awaiting_confirmation",
      expired: false,
      payment: false,
    });
    assert.equal(status(fresh.transfer_id).status, "awaiting_confirmation");
    for (const t of [t14, earlyTransfer])
      assert.deepEqual(status(t.transfer_id), { status: "expired", expired: true, payment: false });
    assert.ok(staffWaiting().items.some((t) => t.transfer_id === t13.transfer_id));
    assert.match(
      preflight()[0][1],
      /^bank transfer expiry: already applied; waiting: 2; waiting 14 days or more: 0; expired: 2$/
    );
  });
  await check("a rerun of the sweep changes nothing more", () => {
    const at = q(`select expired_at from private.invoice_transfers where id='${t14.transfer_id}';`);
    assert.deepEqual(sweep(), swept(0));
    assert.equal(
      q(`select expired_at from private.invoice_transfers where id='${t14.transfer_id}';`),
      at
    );
  });
  await check("the sweep's limit is bounded and each run takes the oldest first", () => {
    fails(sweepSql(0), "22023");
    fails(sweepSql(51), "22023");
    fails(sweepSql("null"), "22023");
    const one = recordDirect(verified("expiry-limit-1"), "FNB LIMIT 0001");
    const two = recordDirect(verified("expiry-limit-2"), "FNB LIMIT 0002");
    age(one.transfer_id, "16 days");
    age(two.transfer_id, "15 days");
    assert.deepEqual(sweep(1), swept(1));
    assert.equal(status(one.transfer_id).status, "expired");
    assert.equal(status(two.transfer_id).status, "awaiting_confirmation");
    assert.deepEqual(sweep(1), swept(1));
    assert.equal(status(two.transfer_id).status, "expired");
  });
  await check("one row that cannot be changed does not stop the others", () => {
    const blocked = recordDirect(verified("expiry-blocked"), "FNB BLOCK 0001");
    const next = recordDirect(verified("expiry-next"), "FNB BLOCK 0002");
    age(blocked.transfer_id, "17 days");
    age(next.transfer_id, "16 days");
    q(`create function vmtest.block_one() returns trigger language plpgsql as $$
        begin if old.bank_reference='FNB BLOCK 0001' then raise exception 'synthetic failure'; end if; return new; end$$;
      create trigger vmtest_block_one before update on private.invoice_transfers
        for each row execute function vmtest.block_one();`);
    // The failing row is returned with its id and SQLSTATE (the job logs it).
    assert.deepEqual(
      sweep(),
      swept(1, 0, [{ transfer_id: blocked.transfer_id, sqlstate: "P0001" }])
    );
    assert.equal(status(blocked.transfer_id).status, "awaiting_confirmation");
    assert.equal(status(next.transfer_id).status, "expired");
    // Still expired by the rule, listed for staff and in the audit trail
    // (at the moment it passed 14 days) before it is marked.
    assert.ok(listedExpired(blocked.transfer_id));
    assert.equal(
      json(`select jsonb_agg(occurred_at=(select recorded_at+interval '14 days' from private.invoice_transfers
          where id='${blocked.transfer_id}')) from private.frontend_staff_audit_events
        where action='payment:invoice_expired' and target_id='${blocked.transfer_id}';`).join(),
      "true"
    );
    q(
      "drop trigger vmtest_block_one on private.invoice_transfers; drop function vmtest.block_one();"
    );
    assert.deepEqual(sweep(), swept(1));
    assert.equal(status(blocked.transfer_id).status, "expired");
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
  await check("a transfer younger than 14 days is confirmed as before", () => {
    assert.equal(transfers.confirm(admin2, t13.transfer_id).status, "confirmed");
    assert.deepEqual(status(t13.transfer_id), {
      status: "confirmed",
      expired: false,
      payment: true,
    });
    // A confirmed transfer is never expired, however old it gets.
    age(t13.transfer_id, "40 days");
    assert.deepEqual(sweep(), swept(0));
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
    assert.deepEqual(sweep(), swept(1));
    assert.equal(status(fresh.transfer_id).status, "expired");
  });
  await check("the bank credit of an expired transfer can be recorded again, once", () => {
    const again = recordDirect(sipho, "FNB DAY14 0001");
    assert.equal(again.status, "awaiting_confirmation");
    assert.notEqual(again.transfer_id, t14.transfer_id);
    // The expired record of the same money is flagged for the second staff member.
    assert.equal(again.similar_records, 1, "an expired record of the same money is flagged");
    assert.match(
      fails(
        transfers.recordSql(admin2, {
          email: sipho.email,
          term: 30,
          slots: 1,
          reference: "FNB DAY14 0001",
        }),
        "PT409"
      ),
      /bank_reference_used/
    );
    assert.equal(transfers.confirm(admin2, again.transfer_id).status, "confirmed");
    assert.match(
      fails(
        transfers.recordSql(admin2, {
          email: sipho.email,
          term: 30,
          slots: 1,
          reference: "FNB DAY14 0001",
        }),
        "PT409"
      ),
      /bank_reference_used/
    );
    // No longer to be followed up: the same money was recorded again and confirmed.
    assert.equal(listedExpired(t14.transfer_id), undefined);
  });
  await check("money that cleared more than 90 days ago: only an expired credit, exactly", () => {
    const zola = verified("expiry-zola");
    const first = recordDirect(zola, "FNB OLD 0090", daysAgo(80));
    // The money cleared 100 days ago and the record has waited 20 days; the
    // sweep has not marked it: recording the credit again marks it first.
    q(`set session_replication_role=replica;
      update private.invoice_transfers set cleared_on=current_date-100,recorded_at=now()-interval '20 days'
        where id='${first.transfer_id}';
      set session_replication_role=origin;`);
    const cleared = q(
      `select to_char(cleared_on,'YYYY-MM-DD') from private.invoice_transfers where id='${first.transfer_id}';`
    );
    for (const other of [
      { reference: "FNB OLD 0091", cleared },
      { reference: "FNB OLD 0090", cleared: daysAgo(101) },
      { reference: "FNB OLD 0090", cleared, term: 90 },
    ])
      fails(
        transfers.recordSql(admin, { email: zola.email, term: 30, slots: 1, ...other }),
        "22023",
        /cleared_date_invalid/
      );
    // The same old money for a different account is refused too.
    fails(
      transfers.recordSql(admin, {
        email: verified("expiry-zola-other").email,
        term: 30,
        slots: 1,
        reference: "FNB OLD 0090",
        cleared,
      }),
      "22023",
      /cleared_date_invalid/
    );
    const again = recordDirect(zola, "FNB OLD 0090", cleared);
    assert.equal(again.status, "awaiting_confirmation");
    assert.deepEqual(status(first.transfer_id), {
      status: "expired",
      expired: true,
      payment: false,
    });
    // Never counted twice: a second record of the credit is refused.
    assert.match(
      fails(
        transfers.recordSql(admin2, {
          email: zola.email,
          term: 30,
          slots: 1,
          reference: "FNB OLD 0090",
          cleared,
        }),
        "PT409"
      ),
      /bank_reference_used/
    );
    assert.equal(transfers.confirm(admin2, again.transfer_id).status, "confirmed");
    assert.equal(
      Number(
        q(`select count(*) from private.invoice_transfers where status in ('awaiting_confirmation','confirmed')
            and upper(regexp_replace(bank_reference,'[^A-Za-z0-9]','','g'))='FNBOLD0090';`)
      ),
      1
    );
  });

  // ---------------------------------------------------- customer invoices
  const buyer = verified("expiry-buyer");
  const stranger = verified("expiry-stranger");
  const invoice = issue(buyer);
  const number = invoice.invoice_number;
  save(buyer, number);
  const toInvoice = json(transferToInvoiceSql(number, "FNB INVOICE 0001"));
  let voidTransfer;

  await check("while a transfer to an invoice waits, the invoice waits too", () => {
    assert.equal(myInvoice(buyer, number).transfer_waiting, true);
    assert.deepEqual(json(expirySql(buyer, number)), {
      invoice_number: number,
      transfer_expired_at: null,
    });
    fails(payNowSql(buyer, number), "PT409", /invoice_transfer_waiting/);
    fails(voidSql(invoice.invoice_id), "PT409", /invoice_transfer_waiting/);
    assert.equal(q(`select internal.account_erasure_hold('${buyer.id}');`), "transfer_waiting");
  });
  await check("after 14 days the invoice is free at once, before the sweep", () => {
    age(toInvoice.transfer_id, "14 days 10 minutes");
    const read = myInvoice(buyer, number);
    assert.equal(read.status, "issued");
    assert.equal(read.transfer_waiting, false);
    const before = json(expirySql(buyer, number)).transfer_expired_at;
    assert.match(before ?? "", /^\d{4}-\d{2}-\d{2}T/);
    assert.notEqual(
      q(`select coalesce(internal.account_erasure_hold('${buyer.id}'),'none');`),
      "transfer_waiting"
    );
    assert.equal(listedExpired(toInvoice.transfer_id).invoice_number, number);
    // Only the invoice's own member: anyone else reads it as not found.
    fails(expirySql(stranger, number), "PT404", /invoice_unavailable/);
    fails(expirySql(buyer, "VM-1999-000001"), "PT404");
    fails(expirySql(buyer, "../admin"), "PT404");
    assert.equal(json(payNowSql(buyer, number)).status, "pending");
    assert.deepEqual(sweep(), swept(1, 1));
    assert.equal(
      json(expirySql(buyer, number)).transfer_expired_at,
      json(
        `select to_jsonb(expired_at) from private.invoice_transfers where id='${toInvoice.transfer_id}';`
      )
    );
  });
  await check("staff can record the transfer to the invoice again; the notice then goes", () => {
    const again = json(transferToInvoiceSql(number, "FNB INVOICE 0001"));
    assert.equal(again.status, "awaiting_confirmation");
    assert.equal(myInvoice(buyer, number).transfer_waiting, true);
    assert.equal(json(expirySql(buyer, number)).transfer_expired_at, null);
    // Not followed up while the new record only waits.
    assert.ok(listedExpired(toInvoice.transfer_id));
    // Declined (as before, members are not shown a decline): no notice, and
    // the expired transfer is still to be followed up.
    json(transfers.declineSql(admin2, again.transfer_id));
    assert.equal(json(expirySql(buyer, number)).transfer_expired_at, null);
    assert.equal(myInvoice(buyer, number).transfer_waiting, false);
    assert.ok(listedExpired(toInvoice.transfer_id));
  });
  await check(
    "an invoice's overdue transfer, unswept: re-recorded (cleared long ago) or voided",
    () => {
      const late = verified("expiry-late-invoice");
      const lateInvoice = issue(late);
      save(late, lateInvoice.invoice_number);
      const first = json(transferToInvoiceSql(lateInvoice.invoice_number, "FNB LATEINV 0001"));
      q(`set session_replication_role=replica;
      update private.invoice_transfers set cleared_on=current_date-120,recorded_at=now()-interval '15 days'
        where id='${first.transfer_id}';
      set session_replication_role=origin;`);
      const cleared = q(
        `select to_char(cleared_on,'YYYY-MM-DD') from private.invoice_transfers where id='${first.transfer_id}';`
      );
      fails(
        transferToInvoiceSql(lateInvoice.invoice_number, "FNB LATEINV 0002", cleared),
        "22023",
        /cleared_date_invalid/
      );
      // The same old money to another invoice of the same account, or with no
      // invoice, is refused: that transfer named this invoice.
      const otherInvoice = issue(late);
      fails(
        transferToInvoiceSql(otherInvoice.invoice_number, "FNB LATEINV 0001", cleared),
        "22023",
        /cleared_date_invalid/
      );
      fails(
        transfers.recordSql(admin, {
          email: late.email,
          term: 30,
          slots: 1,
          reference: "FNB LATEINV 0001",
          cleared,
        }),
        "22023",
        /cleared_date_invalid/
      );
      const again = json(
        transferToInvoiceSql(lateInvoice.invoice_number, "FNB LATEINV 0001", cleared)
      );
      assert.equal(again.status, "awaiting_confirmation");
      assert.equal(status(first.transfer_id).status, "expired");
      assert.equal(transfers.confirm(admin2, again.transfer_id).status, "confirmed");
      assert.equal(myInvoice(late, lateInvoice.invoice_number).status, "paid");
      // Voiding is not held by an overdue transfer either.
      const other = verified("expiry-void");
      const toVoid = issue(other);
      const waiting = json(transferToInvoiceSql(toVoid.invoice_number, "FNB VOID 0001"));
      age(waiting.transfer_id, "15 days");
      assert.equal(json(voidSql(toVoid.invoice_id)).status, "void");
      // Voiding the invoice is not a follow-up of the money.
      assert.ok(listedExpired(waiting.transfer_id), "a void invoice's transfer stays listed");
      voidTransfer = waiting;
    }
  );
  await check("staff resolve an expired transfer once, audited, and it leaves the list", () => {
    const moderator = world.staffUser("expiry-moderator", "moderator");
    fails(resolveSql(moderator, voidTransfer.transfer_id), "42501");
    fails(
      member(
        buyer,
        `select api.resolve_expired_invoice_transfer('${voidTransfer.transfer_id}','returned','Refunded by EFT');`
      ),
      "42501"
    );
    fails(resolveSql(admin2, voidTransfer.transfer_id, "refunded"), "22023");
    fails(resolveSql(admin2, voidTransfer.transfer_id, "returned", "No"), "22023");
    const waitingNow = recordDirect(verified("expiry-not-expired"), "FNB NOTEXP 0001");
    fails(resolveSql(admin2, waitingNow.transfer_id), "PT409", /transfer_not_expired/);
    // Waiting 15 days, not marked yet: resolving marks it expired first.
    assert.equal(status(voidTransfer.transfer_id).status, "awaiting_confirmation");
    const resolved = json(
      resolveSql(admin2, voidTransfer.transfer_id, "returned", "Refunded by EFT")
    );
    assert.equal(resolved.status, "expired");
    assert.equal(resolved.resolution, "returned");
    assert.equal(resolved.repeated, false);
    assert.equal(status(voidTransfer.transfer_id).status, "expired");
    assert.equal(listedExpired(voidTransfer.transfer_id), undefined);
    assert.equal(
      json(resolveSql(admin2, voidTransfer.transfer_id, "returned", "Refunded by EFT")).repeated,
      true
    );
    fails(
      resolveSql(admin2, voidTransfer.transfer_id, "never_arrived"),
      "PT409",
      /transfer_resolved/
    );
    fails(
      resolveSql(admin, voidTransfer.transfer_id, "returned", "Refunded by EFT"),
      "PT409",
      /transfer_resolved/
    );
    // The record keeps it: nothing else may change, and it cannot be undone.
    fails(
      `update private.invoice_transfers set resolution='never_arrived' where id='${voidTransfer.transfer_id}';`,
      "23514"
    );
    assert.deepEqual(
      json(`select jsonb_agg(jsonb_build_object('actor',actor_id,'reason',reason))
        from private.frontend_staff_audit_events
        where action='payment:invoice_expired_resolved' and target_id='${voidTransfer.transfer_id}';`),
      [
        {
          actor: admin2.id,
          reason:
            "Bank transfer FNB VOID 0001 expired, resolved: money returned outside VerifyMzansi: Refunded by EFT",
        },
      ]
    );
  });
  await check("a paid invoice shows no expiry", () => {
    const paid = issue(stranger);
    save(stranger, paid.invoice_number);
    const first = json(transferToInvoiceSql(paid.invoice_number, "FNB PAID 0001"));
    age(first.transfer_id, "20 days");
    sweep();
    const second = json(transferToInvoiceSql(paid.invoice_number, "FNB PAID 0002"));
    assert.equal(json(expirySql(stranger, paid.invoice_number)).transfer_expired_at, null);
    transfers.confirm(admin2, second.transfer_id);
    assert.equal(myInvoice(stranger, paid.invoice_number).status, "paid");
    assert.deepEqual(json(expirySql(stranger, paid.invoice_number)), {
      invoice_number: paid.invoice_number,
      transfer_expired_at: null,
    });
  });

  // --------------------------------------------------- staff visibility
  await check("staff see each expired transfer until it is followed up", () => {
    const read = staffExpired();
    assert.equal(read.unresolved, read.items.length);
    const ids = read.items.map((t) => t.transfer_id);
    // Not followed up: listed however long ago it expired.
    q(`set session_replication_role=replica;
      update private.invoice_transfers set expired_at=now()-interval '200 days',recorded_at=now()-interval '214 days'
        where id='${earlyTransfer.transfer_id}';
      set session_replication_role=origin;`);
    assert.ok(listedExpired(earlyTransfer.transfer_id), "an old unresolved transfer is listed");
    assert.ok(ids.includes(fresh.transfer_id));
    // Followed up: re-recorded, invoice paid or voided.
    // Followed up only by a confirmed record of the same money or a resolution;
    // a declined record of it, or a paid or void invoice, is not enough.
    for (const t of [t14, voidTransfer]) assert.ok(!ids.includes(t.transfer_id));
    assert.ok(ids.includes(toInvoice.transfer_id));
    assert.ok(read.items.every((t) => t.status === "expired"));
    const times = staffExpired().items.map((t) => Date.parse(t.expired_at));
    assert.deepEqual(
      times,
      [...times].sort((a, b) => a - b),
      "oldest first"
    );
    assert.ok(!staffWaiting().items.some((t) => ids.includes(t.transfer_id)));
    fails(member(buyer, "select api.get_staff_expired_invoice_transfers();"), "42501");
    fails(
      staff(
        admin2,
        "select api.get_staff_expired_invoice_transfers();",
        Math.floor(Date.now() / 1000) - 13 * 3600
      ),
      "42501"
    );
  });
  await check("the audit trail lists each recorded expiry with no staff member", () => {
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
    // Expiries have no staff member; a resolution names the staff member.
    for (const item of page.items)
      if (item.action === "payment_invoice_expired") assert.equal(item.actor_id, null);
      else {
        assert.equal(item.action, "payment_invoice_expired_resolved");
        assert.equal(item.actor_id, admin2.id);
      }
  });
  await check("the privacy export names when a bank transfer expired", () => {
    const exported = JSON.stringify(
      json(`select internal.frontend_privacy_export_data('${sipho.id}');`)
    );
    const at = json(
      `select to_jsonb(expired_at) from private.invoice_transfers where id='${t14.transfer_id}';`
    );
    assert.ok(
      exported.includes(`"expired_at":"${at}"`) || exported.includes(`"expired_at": "${at}"`),
      exported.slice(0, 400)
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
      "api.resolve_expired_invoice_transfer(uuid,text,text)": {
        anon: false,
        authenticated: true,
        service_role: false,
      },
    });
    fails(member(buyer, "select api.expire_waiting_bank_transfers(100);"), "42501");
    fails(staff(admin2, "select api.expire_waiting_bank_transfers(100);"), "42501");
    for (const helper of [
      "internal.invoice_transfer_expires_after()",
      "internal.invoice_transfer_expired(private.invoice_transfers)",
      "internal.invoice_transfer_waiting(private.invoice_transfers)",
      "internal.invoice_transfer_credit_expired(text,bigint,date,uuid,uuid)",
      "internal.expire_invoice_transfer(uuid)",
    ])
      assert.deepEqual(executeGrants(json, [helper])[helper], {
        anon: false,
        authenticated: false,
        service_role: false,
      });
  });
  await check("the rollback refuses once a transfer was marked expired", () => {
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
