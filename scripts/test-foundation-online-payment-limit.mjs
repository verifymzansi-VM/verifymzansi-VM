#!/usr/bin/env node
// Behaviour checks for 20261116211438_online_payment_limit.sql and
// 20261116211439_switch_posting_terms_v5.sql (owner's decisions of 16 November
// 2026): the R10,000 online limit is gone; the only online limit left is the
// most Ozow accepts in one payment (internal.online_payment_max_cents, R1,300),
// for new slots, renewals and invoice "Pay now"; members read it with
// api.get_payment_limits; posting-v5 is published, then made current.
//
// Replays database/foundation (prelude, candidate.sql, every update before the
// first one) into the throwaway, network-less Postgres 17 container of the SQL
// lint gate. Members act as `authenticated` with synthetic claims and a live
// session row; the website's server as `service_role`; staff with a verified
// authenticator app and an AAL2 session. The only stand-in is
// internal.current_verified_identity (the member's current accepted fact).
//
//   node --import tsx scripts/test-foundation-online-payment-limit.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertReadOnlyPreflight, createChecks } from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";
import {
  P30,
  P180,
  applyAndProveRollback,
  createPaymentWorld,
  ozowPurchase,
  sqlValue,
  updateCheckKit,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261116211438_online_payment_limit.sql";
const SWITCH = "20261116211439_switch_posting_terms_v5.sql";
const companion = (folder, file, suffix) =>
  readFileSync(`database/foundation/${folder}/${file.replace(/\.sql$/, suffix)}`, "utf8");
const SWITCH_PREFLIGHT = companion("preflight", SWITCH, ".check.sql");
const SWITCH_ROLLBACK = companion("rollback", SWITCH, ".down.sql");
const CATALOGUE = JSON.parse(readFileSync("src/lib/legal/terms-documents/catalogue.json", "utf8"));
const V4 = { version: "posting-v4", document_hash: CATALOGUE.versions["posting-v4"] };
const V5 = { version: "posting-v5", document_hash: CATALOGUE.versions["posting-v5"] };
const LIMIT = 130000;
const SETTING = "internal.online_payment_max_cents()";

const started = Date.now();
const { check, current, passed: checks } = createChecks();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const kit = updateCheckKit(database, UPDATE, current);
  const { q, json, fails, count, member, staff, service, asRole, preflight, fingerprint } = kit;
  const { steps, index } = kit;
  assert.equal(steps[index + 1]?.label, SWITCH, "the switch follows the limit update");
  const world = createPaymentWorld(kit);
  const admin = world.staffUser("limit-admin", "admin");
  const admin2 = world.staffUser("limit-admin2", "admin");
  world.review(admin, admin2, "limit-admin");
  world.review(admin2, admin, "limit-admin2");
  const verified = (label) => world.verified(label, admin);

  const quoteSql = (owner, plan, slots, expected = plan.cents * slots) =>
    member(owner, `select api.start_slot_checkout('${plan.id}',${slots},${expected},true);`);
  const ids = (list) => `array[${list.map((id) => `'${id}'`).join(",")}]::uuid[]`;
  const renewSql = (owner, entitlements, plan) =>
    member(
      owner,
      `select api.start_slot_renewal_checkout(${ids(entitlements)},'${plan.id}',${plan.cents * entitlements.length},true);`
    );
  const grantsOf = (paymentId) =>
    json(`select coalesce(jsonb_agg(e.id order by l.line_number),'[]')
      from private.payment_lines l join private.entitlements e on e.payment_line_id=l.id
      where l.payment_id='${paymentId}';`);
  const travel = (owner, by) =>
    q(`select set_config('session_replication_role','replica',false);
       update private.entitlements set starts_at=starts_at-'${by}'::interval,ends_at=ends_at-'${by}'::interval
         where owner_id='${owner.id}';
       select set_config('session_replication_role','origin',false);`);
  const issueSql = (who, email, term, slots) =>
    staff(
      who,
      `select api.issue_staff_invoice(${sqlValue(email)},${term},${slots},7,'Invoice requested at checkout','${randomUUID()}');`
    );
  const invoiceFor = (owner, term, slots) => {
    const issued = json(issueSql(admin, owner.email, term, slots));
    const mine = json(member(owner, `select api.get_my_invoice('${issued.invoice_number}');`));
    json(
      member(
        owner,
        `select api.save_my_invoice_billing('${issued.invoice_number}',${mine.revision},'Fixture Traders (Pty) Ltd','1 Example Road\nEmpangeni\n3880',null);`
      )
    );
    return issued;
  };
  const payNowSql = (owner, invoice) =>
    member(
      owner,
      `select api.start_invoice_payment('${invoice.invoice_number}',${invoice.total_cents},true);`
    );
  const payments = (owner) => count(`private.payments where owner_id='${owner.id}'`);
  const limitsSql = (owner) => member(owner, "select api.get_payment_limits();");
  const currentTerms = () =>
    json(`select jsonb_build_object('version',c.version,'document_hash',v.document_hash)
      from private.posting_terms_current c join private.posting_terms_versions v on v.version=c.version
      where c.singleton;`);

  // ------------------------------------------------------------ before
  await check(
    "before the update: the preflight reads 'not applied' and R10,000 still applies",
    () => {
      const rows = preflight();
      assert.deepEqual(
        rows.map((r) => r[0]),
        ["summary"],
        JSON.stringify(rows)
      );
      assert.equal(
        rows[0][1],
        "online payment limit: update not applied (apply before the website release that uses it is deployed); current posting terms: posting-v4; posting-v5 not published; payments pending at Ozow above R1,300: 0; unpaid invoices above R1,300: 0"
      );
      assertReadOnlyPreflight(database, kit.preflightSql);
      const early = verified("limit-early");
      fails(limitsSql(early), "42883");
      // Four 180-day slots (R1,656) were accepted online before.
      assert.equal(json(quoteSql(early, P180, 4)).amount_cents, "165600");
    }
  );

  await check("the update refuses a drifted body, changing nothing", () => {
    const before = fingerprint();
    const sig = "internal.start_invoice_payment(text,bigint,boolean)";
    const original = q(`select pg_get_functiondef('${sig}'::regprocedure);`);
    q(
      original.replace(
        "raise exception 'invoice total required'",
        "raise exception 'invoice total needed'"
      ) + ";"
    );
    assert.match(
      fails(kit.step.sql, "55000"),
      /start_invoice_payment\(text,bigint,boolean\) [0-9a-f]{32} is not a reviewed body/
    );
    assert.match(preflight()[1][1], /start_invoice_payment\(text,bigint,boolean\) is neither/);
    q(`${original};`);
    assert.equal(fingerprint(), before);
  });

  await check("the update refuses when posting-v4 is not current", () => {
    q("update private.posting_terms_current set version='posting-v3' where singleton;");
    assert.match(fails(kit.step.sql, "55000"), /current posting terms are posting-v3/);
    q("update private.posting_terms_current set version='posting-v4' where singleton;");
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: UPDATE,
    applied:
      /^online payment limit: already applied; current posting terms: posting-v4; posting-v5 published; payments pending at Ozow above R1,300: 0; unpaid invoices above R1,300: 0$/,
    notApplied: /^online payment limit: update not applied/,
  });

  await check("posting-v5 is published with its hash and posting-v4 stays current", () => {
    assert.equal(
      q("select document_hash from private.posting_terms_versions where version='posting-v5';"),
      V5.document_hash
    );
    assert.deepEqual(currentTerms(), V4);
  });

  // ------------------------------------------------------------- limits
  await check("members and visitors read the limit (public, no account data)", () => {
    const reader = verified("limit-reader");
    assert.deepEqual(json(limitsSql(reader)), { online_max_cents: LIMIT });
    assert.deepEqual(json(limitsSql(world.user("limit-unverified"))), { online_max_cents: LIMIT });
    assert.deepEqual(json(asRole("anon", "select api.get_payment_limits();")), {
      online_max_cents: LIMIT,
    });
    fails(service("select api.get_payment_limits();"), "42501");
    fails(asRole("authenticated", `select ${SETTING};`), "42501");
  });

  await check("a new order above the limit is refused online; at or below it is accepted", () => {
    const thabo = verified("limit-thabo");
    // Four 180-day slots: R1,656, above R1,300.
    fails(
      quoteSql(thabo, P180, 4),
      "PT413",
      /above the online payment limit of 130000 cents; ask for an invoice/
    );
    assert.equal(payments(thabo), 0, "a refused order writes no payment");
    // Three 180-day slots: R1,242, accepted.
    assert.equal(json(quoteSql(thabo, P180, 3)).amount_cents, "124200");
  });

  await check("the total exactly at the setting is accepted, one cent more is refused", () => {
    // 18 thirty-day slots are R1,242; with the setting at that amount it is the boundary.
    const sipho = verified("limit-sipho");
    q(`insert into private.individual_slot_limits(identity_hmac,account_id,slot_limit,ends_at,reason,granted_by)
       values('${sipho.fingerprint}','${sipho.id}',25,now()+interval '200 days','Checked dealer, interim offer','${admin.id}');`);
    const body = q(`select pg_get_functiondef('${SETTING}'::regprocedure);`);
    try {
      q(body.replace("130000::bigint", "124200::bigint") + ";");
      assert.equal(json(quoteSql(sipho, P30, 18)).amount_cents, "124200");
      fails(quoteSql(sipho, P30, 19), "PT413", /online payment limit of 124200 cents/);
      assert.deepEqual(json(limitsSql(sipho)), { online_max_cents: 124200 });
    } finally {
      q(`${body};`);
    }
  });

  await check("a raised setting reaches a long-lived session that already used it", () => {
    // STABLE, not IMMUTABLE: a pooled connection that has run the checkout
    // sees a new value at once (one psql session throughout).
    const mpho = verified("limit-mpho");
    const body = q(`select pg_get_functiondef('${SETTING}'::regprocedure);`);
    try {
      const out = q(
        member(
          mpho,
          `do $$begin
             perform api.start_slot_checkout('${P180.id}',4,165600,true);
             raise exception 'accepted above the limit';
           exception when sqlstate 'PT413' then null; end$$;
           reset role;
           ${body.replace("130000::bigint", "200000::bigint")};
           set role authenticated;
           select 'amount='||(api.start_slot_checkout('${P180.id}',4,165600,true)->>'amount_cents');`
        )
      );
      assert.match(out, /amount=165600$/);
    } finally {
      q(`${body};`);
    }
    assert.equal(q(`select ${SETTING};`), String(LIMIT));
    assert.equal(q(`select provolatile from pg_proc where oid='${SETTING}'::regprocedure;`), "s");
  });

  await check("the server never opens an Ozow request above the limit (final guard)", () => {
    // A payment started while the setting was higher (here 200000), then
    // lowered back: the lease before asking Ozow refuses it.
    const lindi = verified("limit-lindi");
    const body = q(`select pg_get_functiondef('${SETTING}'::regprocedure);`);
    let paymentId;
    try {
      q(body.replace("130000::bigint", "200000::bigint") + ";");
      paymentId = json(
        member(lindi, `select api.start_slot_checkout('${P180.id}',4,165600,true);`)
      ).payment_id;
    } finally {
      q(`${body};`);
    }
    fails(
      service(`select api.claim_checkout_request('${paymentId}','${lindi.id}');`),
      "PT413",
      /online_payment_above_limit/
    );
    assert.equal(
      q(`select checkout_claim_token is null from private.payments where id='${paymentId}';`),
      "t"
    );
  });

  await check(
    "a renewal above the limit is refused; fewer slots in one payment are accepted",
    () => {
      const gugu = verified("limit-gugu");
      const all = grantsOf(ozowPurchase(kit, gugu, P30, 4));
      travel(gugu, "20 days");
      fails(renewSql(gugu, all, P180), "PT413", /renew fewer slots in one payment/);
      assert.equal(json(renewSql(gugu, all.slice(0, 3), P180)).amount_cents, "124200");
    }
  );

  await check(
    "a package above the limit is bought by invoice; 100 slots stays the other rule",
    () => {
      // The 30- and 90-day package terms of 20261114154823_slot_packages.sql (R100 per slot per 30 days).
      const K30 = "5b0f4c1e-2a7d-4c43-9b51-7e0d3f6a9c11";
      const K90 = "8c3e1a52-6f0b-4d29-a7c4-2b9e5d1f7a33";
      const pkg = (owner, plan, slots, cents) =>
        member(owner, `select api.start_package_checkout('${plan}',${slots},${cents},true);`);
      q(
        "update private.slot_package_sales set on_sale=true,changed_at=now(),reason='Fixture: switched for the checks';"
      );
      try {
        const nandi = verified("limit-nandi");
        // 13 slots for 30 days: R1,300 exactly, online.
        assert.equal(json(pkg(nandi, K30, 13, 130000)).amount_cents, "130000");
        const zola = verified("limit-zola");
        fails(
          pkg(zola, K30, 14, 140000),
          "PT413",
          /online payment limit of 130000 cents are paid by invoice/
        );
        // 5 slots for 90 days: R1,500, by invoice.
        fails(pkg(zola, K90, 5, 150000), "PT413", /package_invoice_required|paid by invoice/);
        assert.equal(payments(zola), 0);
      } finally {
        q(
          "update private.slot_package_sales set on_sale=false,changed_at=now(),reason='Fixture: switched back';"
        );
      }
    }
  );

  await check(
    "invoice Pay now above the limit is refused (bank transfer only); at or below it starts",
    () => {
      const lerato = verified("limit-lerato");
      const big = invoiceFor(lerato, 180, 4);
      assert.equal(Number(big.total_cents), 165600);
      fails(payNowSql(lerato, big), "PT413", /pay it by bank transfer/);
      assert.equal(payments(lerato), 0, "nothing is written for a refused Pay now");
      assert.equal(
        count(`private.customer_invoice_payments l join private.customer_invoices i on i.id=l.invoice_id
      where i.invoice_number='${big.invoice_number}'`),
        0
      );
      const preflightRow = preflight()[0][1];
      assert.match(preflightRow, /unpaid invoices above R1,300: 1$/);
      // The same member can still pay a smaller invoice online.
      const small = invoiceFor(lerato, 90, 3);
      assert.equal(Number(small.total_cents), 62100);
      assert.equal(json(payNowSql(lerato, small)).amount_cents, "62100");
    }
  );

  // ------------------------------------------------------------- switch
  const switchStep = steps[index + 1];
  const switchPreflight = () =>
    q(SWITCH_PREFLIGHT)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|"));
  await check("switch preflight before: posting-v4 current, posting-v5 published", () => {
    assert.deepEqual(switchPreflight(), [
      [
        "summary",
        "current posting-v4 (update not applied); posting-v5 published; accounts that accepted posting-v5: 0",
      ],
    ]);
    assertReadOnlyPreflight(database, SWITCH_PREFLIGHT);
  });

  const beforeSwitch = fingerprint();
  applySteps(database, [switchStep]);
  await check("the switch makes posting-v5 current and members accept it once", () => {
    assert.deepEqual(currentTerms(), V5);
    assert.equal(fingerprint(), beforeSwitch, "the switch changes no schema");
    const buyer = verified("limit-terms");
    const asked = json(member(buyer, "select api.get_owner_posting_terms();"));
    assert.equal(asked.version, "posting-v5");
    assert.equal(asked.accepted_at, null);
    fails(
      member(buyer, `select api.accept_posting_terms('${V4.version}','${V4.document_hash}');`),
      "PT409",
      /posting terms changed/
    );
    assert.equal(
      json(member(buyer, `select api.accept_posting_terms('${V5.version}','${V5.document_hash}');`))
        .version,
      "posting-v5"
    );
    assert.deepEqual(switchPreflight(), [
      [
        "summary",
        "current posting-v5 (update already applied); posting-v5 published; accounts that accepted posting-v5: 1",
      ],
    ]);
    // A new payment records posting-v5 with its consent.
    const paid = ozowPurchase(kit, buyer, P30, 1);
    assert.equal(
      q(
        `select snapshot->'cooling_off_consent'->>'terms_version' from private.payments where id='${paid}';`
      ),
      "posting-v5"
    );
  });

  await check("the limit rollback refuses while posting-v5 is current", () => {
    assert.match(fails(kit.rollbackSql, "55000"), /posting-v5 is current/);
  });

  await check(
    "the switch rollback makes posting-v4 current; re-applying makes posting-v5 current",
    () => {
      applySteps(database, [{ label: `${SWITCH} rollback`, sql: SWITCH_ROLLBACK }]);
      assert.deepEqual(currentTerms(), V4);
      assert.match(fails(SWITCH_ROLLBACK, "55000"), /posting-v5 is not the current posting terms/);
      applySteps(database, [switchStep]);
      applySteps(database, [switchStep]);
      assert.deepEqual(currentTerms(), V5);
      assert.equal(fingerprint(), beforeSwitch);
    }
  );

  const later = steps.slice(index + 2);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the limit and posting-v5", () => {
      assert.deepEqual(currentTerms(), V5);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Online payment limit checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
