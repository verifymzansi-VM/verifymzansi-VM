#!/usr/bin/env node
// Behaviour checks for 20261113133605_staff_invoice_payments.sql: staff record
// a cleared bank transfer (EFT) as an ordinary payment with the method
// 'invoice' (roadmap P2b, first slice).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Staff act with a verified authenticator app and an AAL2 session;
// members buy with the production checkout command and the website server's
// settlement (as `service_role`, with synthetic Ozow ids) for the comparison
// with an Ozow payment. The only stand-in is
// internal.current_verified_identity, which answers with the member's current
// accepted identity fact (identity review has its own suites). The script
// checks the read-only preflight and the update's refusals, applies the
// update, proves apply -> rollback -> apply returns the schema fingerprint to
// the same values, then checks: a recorded bank transfer gives the same slots,
// invoice, receipt event and partner commission as an Ozow payment of the same
// order; the same request again returns the first result; a bank reference is
// used once (whatever its case, spaces or punctuation, also by two staff
// members at once); every refusal (not staff, no capability, no own ID review,
// the staff member's own identity, wrong amount, above R50,000, unknown or
// unverified customer, no written waiver, a bad reference or date, over the
// slot limit) records nothing; the staff refund commands work on it (whole
// payment, one slot, a second approver above R1,000) and reverse its
// commission; the records never change; the audit trail and receipt read; the
// grants; and that the rollback refuses once a transfer was recorded.
//
//   node --import tsx scripts/test-foundation-staff-invoice-payments.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Members,
// staff, identity facts and partners are written directly as the database
// owner. Nothing contacts Ozow or a bank.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  assertReadOnlyPreflight,
  createChecks,
  sqlHelpers,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261113133605_staff_invoice_payments.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");
const P30 = { id: "d6ca48e5-43be-40df-8d8c-72c98a6fda96", cents: 6900 };
const P180 = { id: "ce4ef578-344a-4816-ab6a-6961bec46621", cents: 41400 };
const RECORD =
  "api.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)";
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
    declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); mail text; begin
      mail:=p_label||'-'||left(uid::text,8)||'@example.invalid';
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(uid,mail,now(),jsonb_build_object('display_name','Fixture '||p_label));
      insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
      return jsonb_build_object('id',uid,'session',sid,'email',mail);
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
    -- An ended accepted review: the account was once reviewed as that person.
    create function vmtest.past_identity(p_owner uuid,p_staff uuid,p_fp text) returns void language plpgsql as $$
    begin
      perform set_config('session_replication_role','replica',true);
      insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by,revoked_at)
        values(p_owner,gen_random_uuid(),p_fp,p_staff,now());
      perform set_config('session_replication_role','origin',true);
    end$$;
    create or replace function internal.current_verified_identity(p_owner uuid) returns text
      language sql set search_path to 'pg_catalog' as $fn$
      select f.identity_hmac from private.accepted_identity_facts f where f.owner_id=p_owner and f.revoked_at is null
        and exists(select 1 from private.current_account_access a where a.id=p_owner) $fn$;`);
  const user = (label) => json(`select vmtest.member('${label}');`);
  const staffUser = (label, role) => json(`select vmtest.staff('${label}','${role}');`);
  const admin = staffUser("eft-admin", "admin");
  const admin2 = staffUser("eft-admin2", "admin");
  const unreviewedAdmin = staffUser("eft-admin3", "admin");
  const moderator = staffUser("eft-moderator", "moderator");
  const verified = (label) => {
    const m = user(label);
    m.fingerprint = fingerprintOf(label);
    q(`select vmtest.verified('${m.id}','${admin.id}','${m.fingerprint}');`);
    return m;
  };
  q(`select vmtest.verified('${admin.id}','${admin2.id}','${fingerprintOf("eft-admin")}');`);
  q(`select vmtest.verified('${admin2.id}','${admin.id}','${fingerprintOf("eft-admin2")}');`);
  const today = q("select to_char((now() at time zone 'Africa/Johannesburg')::date,'YYYY-MM-DD');");
  const daysAgo = (n) =>
    q(`select to_char((now() at time zone 'Africa/Johannesburg')::date - ${n},'YYYY-MM-DD');`);
  // A separate psql session, for the concurrency check.
  const session = (sql) =>
    new Promise((resolve) => {
      const child = spawn(
        "docker",
        ["exec", "-i", database.name, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"].concat([
          "-U",
          "postgres",
          "-d",
          "postgres",
        ]),
        { windowsHide: true }
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (data) => (stdout += data));
      child.stderr.on("data", (data) => (stderr += data));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
      child.stdin.end(`\\set VERBOSITY verbose\n${sql}`);
    });
  const sessionAfter = (ms, sql) =>
    new Promise((resolve) => setTimeout(resolve, ms)).then(() => session(sql));

  /** An Ozow purchase through checkout and the settlement notice. */
  const buy = (owner, plan, slots) => {
    const quoted = json(
      member(
        owner,
        `select api.start_slot_checkout('${plan.id}',${slots},${plan.cents * slots},true);`
      )
    );
    const lease = json(
      service(`select api.claim_checkout_request('${quoted.payment_id}','${owner.id}');`)
    );
    q(
      service(
        `select api.complete_checkout_request('${quoted.payment_id}','${owner.id}','${lease.claim_token}','req-${quoted.payment_id}','https://one.ozow.com/checkout/req-${quoted.payment_id}');`
      )
    );
    const ref = q(`select merchant_reference from private.payments where id='${quoted.payment_id}';`);
    const event = {
      payload_sha256: sha(`event-${quoted.payment_id}`),
      merchant_reference: ref,
      provider_request_id: `req-${quoted.payment_id}`,
      provider_transaction_id: `tx-${quoted.payment_id}`,
      status: "complete",
      amount_cents: plan.cents * slots,
      currency: "ZAR",
    };
    assert.equal(
      json(service(`select api.apply_provider_event($e$${JSON.stringify(event)}$e$::jsonb);`))
        .outcome,
      "completed"
    );
    return quoted.payment_id;
  };
  const literal = (value) =>
    value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;
  /** The staff command's SQL, with every argument overridable. */
  const recordSql = (who, input) => {
    const a = {
      email: null,
      term: 180,
      slots: 1,
      amount: null,
      reference: null,
      cleared: today,
      waiver: true,
      reason: "EFT cleared; customer agreed in writing",
      ...input,
    };
    const amount = a.amount ?? (a.term === 30 ? 6900 : a.term === 90 ? 20700 : 41400) * a.slots;
    return staff(
      who,
      `select api.record_staff_invoice_payment(${literal(a.email)},${a.term === null ? "null" : a.term},${a.slots === null ? "null" : a.slots},${amount},${literal(a.reference)},${literal(a.cleared)},${a.waiver === null ? "null" : a.waiver},${literal(a.reason)});`
    );
  };
  const record = (who, input) => json(recordSql(who, input));
  const payment = (id) =>
    json(`select jsonb_build_object('status',status,'fulfillment',fulfillment_status,'provider',provider,
      'tx',provider_transaction_id,'request',provider_request_id,'amount',amount_cents,'owner',owner_id)
      from private.payments where id='${id}';`);
  /** What a payment delivered, without ids and times: lines, slots, invoice, receipt event, commissions. */
  const delivered = (id) =>
    json(`select jsonb_build_object(
      'lines',(select jsonb_agg(jsonb_build_array(l.line_number,l.amount_cents,l.status) order by l.line_number)
        from private.payment_lines l where l.payment_id='${id}'),
      'slots',(select jsonb_agg(jsonb_build_array(e.source,e.status,e.slot_capacity,e.activations_per_period,
          e.activation_period_days,e.max_photos,e.max_videos,e.addon_capabilities,
          round(extract(epoch from e.ends_at-e.starts_at)/86400),e.payment_line_id is not null,
          e.starts_at=(select p.completed_at from private.payments p where p.id='${id}')) order by e.payment_line_id)
        from private.entitlements e where e.payment_id='${id}'),
      'invoice',(select jsonb_build_array(i.total_cents,i.vat_cents,i.amount_ex_vat_cents,i.description,
          i.invoice_number ~ '^INV-[0-9]{8}-[0-9A-F]{10}$') from private.invoices i where i.payment_id='${id}'),
      'receipt_event',(select count(*) from private.outbox_events o where o.kind='payment_completed' and o.subject_id='${id}'),
      'commissions',(select jsonb_agg(jsonb_build_array(c.base_cents,c.rate_bps,c.amount_cents,c.status,
          c.payment_line_id is not null) order by c.base_cents, c.payment_line_id) from private.partner_commissions c
        where c.payment_id='${id}'));`);
  const transfers = () => count("private.invoice_payments");

  // ------------------------------------------------------------ before
  await check("before the update: preflight reads 'not applied', the command is absent", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^staff invoice payments: update not applied \(apply before the website release that uses it is deployed\); payments recorded by bank transfer: none \(table absent\)$/
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
    fails(recordSql(admin, { email: "x@example.invalid", reference: "REF-0001" }), "42883");
  });

  await check("the update refuses without the reviewed bodies and with a drifted table", () => {
    const before = fingerprint();
    const original = q(
      "select pg_get_functiondef('internal.individual_slot_limit(text)'::regprocedure);"
    );
    q(`create or replace function internal.individual_slot_limit(p_identity text) returns integer
      language sql stable set search_path to 'pg_catalog' as $fn$ select 100 $fn$;`);
    assert.match(
      fails(step.sql, "55000"),
      /apply 20261113021223_staff_payment_fixes\.sql first/
    );
    assert.match(
      preflight()
        .map((r) => r[1])
        .join("\n"),
      /internal\.individual_slot_limit\(text\) is not the reviewed body/
    );
    q(original);
    q("create table private.invoice_payments(payment_id uuid primary key);");
    assert.match(fails(step.sql, "55000"), /table drift: private\.invoice_payments payment_id/);
    q("drop table private.invoice_payments;");
    q(`create table private.invoice_payments(payment_id uuid not null, account_id uuid not null,
      bank_reference text not null, amount_received_cents bigint not null, cleared_on date not null,
      cooling_off_waiver_confirmed boolean not null, reason text not null, recorded_by uuid not null,
      recorded_at timestamptz not null);`);
    assert.match(
      fails(step.sql, "55000"),
      /constraint or index drift: private\.invoice_payments/
    );
    q("drop table private.invoice_payments;");
    q(`alter table private.payments drop constraint payments_provider_check;
       alter table private.payments add constraint payments_provider_check check (provider in ('ozow','card'));`);
    assert.match(fails(step.sql, "55000"), /payments constraints differ/);
    q(`alter table private.payments drop constraint payments_provider_check;
       alter table private.payments add constraint payments_provider_check check (provider = 'ozow');`);
    assert.equal(fingerprint(), before);
  });

  // An Ozow payment from before the update keeps meeting the payment rules.
  const early = verified("early");
  const earlyPayment = buy(early, P30, 1);

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
      /^staff invoice payments: already applied; payments recorded by bank transfer: 0$/
    );
    applySteps(database, [{ label: "staff invoice payments rollback", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before, "the rollback leaves the pre-update schema");
    assert.match(preflight()[0][1], /^staff invoice payments: update not applied/);
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
    assert.equal(payment(earlyPayment).provider, "ozow");
  });

  // A partner who referred two customers: one pays by Ozow, one by bank transfer.
  const partner = user("eft-partner");
  q(`select set_config('session_replication_role','replica',false);
    insert into private.partners(account_id,code,status,commission_bps,created_by)
      values('${partner.id}','EFTPART1','active',2000,'${admin.id}');
    select set_config('session_replication_role','origin',false);`);
  const referred = (label) => {
    const m = verified(label);
    q(`select set_config('session_replication_role','replica',false);
      insert into private.account_acquisitions(account_id,source,partner_id)
        values('${m.id}','partner',(select id from private.partners where account_id='${partner.id}'));
      select set_config('session_replication_role','origin',false);`);
    return m;
  };

  // ------------------------------------------------------------- record
  const thandi = referred("thandi");
  const ozowBuyer = referred("ozow-buyer");
  let thandiPayment;
  await check(
    "a recorded bank transfer delivers exactly what an Ozow payment of the same order does",
    () => {
      const result = record(admin, {
        email: thandi.email,
        term: 180,
        slots: 2,
        reference: "FNB 2026-11 A1",
      });
      thandiPayment = result.payment_id;
      assert.deepEqual(
        [
          result.slots,
          result.term_days,
          result.amount_cents,
          result.commissions,
          result.payment_status,
          result.repeated,
          result.customer_name,
        ],
        [2, 180, 82800, 2, "complete", false, "Fixture t."]
      );
      assert.deepEqual(payment(thandiPayment), {
        status: "complete",
        fulfillment: "fulfilled",
        provider: "invoice",
        tx: null,
        request: null,
        amount: 82800,
        owner: thandi.id,
      });
      const ozowPayment = buy(ozowBuyer, P180, 2);
      const viaBank = delivered(thandiPayment);
      const viaOzow = delivered(ozowPayment);
      assert.deepEqual(viaBank, viaOzow);
      assert.deepEqual(viaBank.commissions, [
        [41400, 2000, 8280, "pending", true],
        [41400, 2000, 8280, "pending", true],
      ]);
      assert.equal(viaBank.receipt_event, 1);
      // The customer sees the slots; the transfer record and the audit trail.
      assert.equal(json(member(thandi, "select api.get_my_slots();")).individual.held, 2);
      assert.equal(
        q(
          `select bank_reference||'|'||amount_received_cents||'|'||cleared_on||'|'||recorded_by||'|'||cooling_off_waiver_confirmed from private.invoice_payments where payment_id='${thandiPayment}';`
        ),
        `FNB 2026-11 A1|82800|${today}|${admin.id}|true`
      );
      assert.equal(
        count(
          `private.frontend_staff_audit_events where target_id='${thandiPayment}' and action='payment:invoice_recorded' and actor_id='${admin.id}' and reason like 'Bank transfer FNB 2026-11 A1 cleared ${today}: EFT cleared%'`
        ),
        1
      );
      // The staff list shows it as an ordinary delivered payment.
      const listed = json(staff(admin, "select api.get_staff_payment_list(1);")).items.find(
        (i) => i.id === thandiPayment
      );
      assert.deepEqual(
        [listed.status, listed.fulfillment_status, listed.lines.length],
        ["complete", "fulfilled", 2]
      );
    }
  );

  await check(
    "the staff read gives the transfer details; the receipt read the bank reference",
    () => {
      const read = (who, ids) =>
        json(
          staff(
            who,
            `select api.get_staff_invoice_payments(array[${ids.map((id) => `'${id}'`).join(",")}]::uuid[]);`
          )
        );
      const mine = read(admin, [thandiPayment, earlyPayment]);
      assert.equal(mine.items.length, 1);
      assert.deepEqual(
        [
          mine.items[0].payment_id,
          mine.items[0].bank_reference,
          mine.items[0].cleared_on,
          mine.items[0].amount_received_cents,
          mine.items[0].recorded_by_me,
        ],
        [thandiPayment, "FNB 2026-11 A1", today, 82800, true]
      );
      assert.equal(read(admin2, [thandiPayment]).items[0].recorded_by_me, false);
      assert.deepEqual(read(admin, []).items, []);
      fails(staff(moderator, `select api.get_staff_invoice_payments(array[]::uuid[]);`), "42501");
      fails(member(thandi, `select api.get_staff_invoice_payments(array[]::uuid[]);`), "42501");
      fails(
        staff(
          admin,
          `select api.get_staff_invoice_payments(array_fill(gen_random_uuid(),array[51]));`
        ),
        "22023"
      );
      fails(
        staff(admin, `select api.get_staff_invoice_payments(array[null]::uuid[]);`),
        "22023"
      );
      const receipt = json(service(`select api.get_payment_receipt('${thandiPayment}');`));
      assert.deepEqual(
        [receipt.payment_method, receipt.bank_reference, receipt.slots, receipt.amount_cents],
        ["invoice", "FNB 2026-11 A1", 2, 82800]
      );
      assert.ok(receipt.invoice_number);
      const ozowReceipt = json(service(`select api.get_payment_receipt('${earlyPayment}');`));
      assert.deepEqual(
        [ozowReceipt.payment_method, ozowReceipt.bank_reference],
        ["ozow", null]
      );
    }
  );

  await check("the same request again returns the first result; a reference is used once", () => {
    const again = record(admin, {
      email: thandi.email,
      term: 180,
      slots: 2,
      reference: "FNB 2026-11 A1",
    });
    assert.deepEqual(
      [again.payment_id, again.repeated, again.commissions, again.slots],
      [thandiPayment, true, 2, 2]
    );
    // The same request with the reference written differently is the same request.
    assert.equal(
      record(admin, { email: thandi.email, term: 180, slots: 2, reference: "fnb/2026.11-a1" })
        .payment_id,
      thandiPayment
    );
    const other = verified("other-customer");
    for (const [who, input] of [
      // Another staff member, the same transfer (also written differently).
      [admin2, { email: thandi.email, term: 180, slots: 2, reference: "FNB 2026-11 A1" }],
      [admin2, { email: thandi.email, term: 180, slots: 2, reference: "fnb202611a1" }],
      // The same reference for another order, customer, date or reason.
      [admin, { email: thandi.email, term: 180, slots: 1, reference: "FNB 2026-11 A1" }],
      [admin, { email: thandi.email, term: 90, slots: 2, reference: "FNB 2026-11 A1" }],
      [admin, { email: other.email, term: 30, slots: 1, reference: "FNB 2026-11 A1" }],
      [
        admin,
        {
          email: thandi.email,
          term: 180,
          slots: 2,
          reference: "FNB 2026-11 A1",
          cleared: daysAgo(1),
        },
      ],
      [
        admin,
        {
          email: thandi.email,
          term: 180,
          slots: 2,
          reference: "FNB 2026-11 A1",
          reason: "A second transfer, same reference",
        },
      ],
    ])
      fails(recordSql(who, input), "PT409", /bank reference was already recorded/);
    assert.equal(transfers(), 1);
    assert.equal(count(`private.payments where owner_id='${thandi.id}'`), 1);
  });

  await check("every refusal records nothing", () => {
    const zola = verified("zola");
    const unverified = user("unverified");
    const ok = { email: zola.email, term: 30, slots: 1 };
    const refusals = [
      [member(zola, `select ${RECORD.replace(/\(.*$/, "")}('${zola.email}',30,1,6900,'REF-MEMBER','${today}',true,'Recording my own');`), "42501", /second factor required/],
      [recordSql(moderator, { ...ok, reference: "REF-MOD-1" }), "42501", /capability not granted/],
      [recordSql(unreviewedAdmin, { ...ok, reference: "REF-UNREV-1" }), "42501", /accepted ID review of their own/],
      [recordSql(admin, { ...ok, email: admin.email, reference: "REF-SELF-1" }), "42501", /different staff member/],
      [recordSql(admin, { ...ok, amount: 6800, reference: "REF-AMOUNT-1" }), "PT428", /not the order total of 6900 cents/],
      [recordSql(admin, { ...ok, amount: 5000001, reference: "REF-BIG-1" }), "PT413", /above R50,000/],
      [recordSql(admin, { ...ok, email: "nobody@example.invalid", reference: "REF-NONE-1" }), "PT404", /no confirmed account/],
      [recordSql(admin, { ...ok, email: unverified.email, reference: "REF-UNVER-1" }), "PT412", /ID review must be accepted/],
      [recordSql(admin, { ...ok, waiver: false, reference: "REF-WAIVE-1" }), "22023", /cooling-off waiver/],
      [recordSql(admin, { ...ok, waiver: null, reference: "REF-WAIVE-2" }), "22023", /cooling-off waiver/],
      [recordSql(admin, { ...ok, reference: null }), "22023", /bank reference required/],
      [recordSql(admin, { ...ok, reference: "  " }), "22023", /bank reference required/],
      [recordSql(admin, { ...ok, reference: "A-1" }), "22023", /4 to 60 letters/],
      [recordSql(admin, { ...ok, reference: "R--1--2" }), "22023", /4 to 60 letters/],
      [recordSql(admin, { ...ok, reference: "REF;DROP" }), "22023", /4 to 60 letters/],
      [recordSql(admin, { ...ok, reference: "X".repeat(61) }), "22023", /4 to 60 letters/],
      [recordSql(admin, { ...ok, reference: "REF-DATE-1", cleared: daysAgo(-1) }), "22023", /last 90 days/],
      [recordSql(admin, { ...ok, reference: "REF-DATE-2", cleared: daysAgo(91) }), "22023", /last 90 days/],
      [recordSql(admin, { ...ok, reference: "REF-DATE-3", cleared: "2026-02-30" }), "22023", /date the money cleared/],
      [recordSql(admin, { ...ok, reference: "REF-DATE-4", cleared: "13/11/2026" }), "22023", /date the money cleared/],
      [recordSql(admin, { ...ok, reference: "REF-TERM-1", term: 60, amount: 13800 }), "22023", /slot term/],
      [recordSql(admin, { ...ok, reference: "REF-SLOTS-1", slots: 26 }), "22023", /number of slots/],
      [recordSql(admin, { ...ok, reference: "REF-SLOTS-2", slots: 0, amount: 6900 }), "22023", /number of slots/],
      [recordSql(admin, { ...ok, reference: "REF-REASON-1", reason: "no" }), "22023", /audit reason/],
    ];
    for (const [sql, state, message] of refusals) fails(sql, state, message);
    // Money cleared 90 days ago is still accepted.
    const ninety = record(admin, { ...ok, reference: "REF-DATE-OK", cleared: daysAgo(90) });
    assert.equal(ninety.repeated, false);
    assert.equal(transfers(), 2);
    assert.equal(count("private.invoice_payments where bank_reference like 'REF-%' and bank_reference <> 'REF-DATE-OK'"), 0);
  });

  await check("the Individual slot limit applies to bank transfers too", () => {
    const sipho = verified("sipho");
    buy(sipho, P30, 3);
    fails(
      recordSql(admin, { email: sipho.email, term: 30, slots: 2, reference: "SIPHO-0001" }),
      "PT429",
      /raise the limit first/
    );
    const one = record(admin, { email: sipho.email, term: 30, slots: 1, reference: "SIPHO-0002" });
    assert.equal(one.slots, 1);
    assert.equal(json(member(sipho, "select api.get_my_slots();")).individual.held, 4);
    fails(
      recordSql(admin, { email: sipho.email, term: 30, slots: 1, reference: "SIPHO-0003" }),
      "PT429"
    );
    // The staff member cannot record for another account of their own identity either.
    const mirror = user("admin-second-account");
    q(`select vmtest.past_identity('${mirror.id}','${admin2.id}','${fingerprintOf("eft-admin")}');`);
    fails(
      recordSql(admin, { email: mirror.email, term: 30, slots: 1, reference: "MIRROR-0001" }),
      "42501",
      /different staff member/
    );
  });

  await check("staff never record a payment that earns them commission", () => {
    // The admin is also an active partner who referred this customer.
    const referredByStaff = verified("referred-by-staff");
    q(`select set_config('session_replication_role','replica',false);
      insert into private.partners(account_id,code,status,commission_bps,created_by)
        values('${admin.id}','STAFFP01','active',2000,'${admin2.id}');
      insert into private.account_acquisitions(account_id,source,partner_id)
        values('${referredByStaff.id}','partner',(select id from private.partners where account_id='${admin.id}'));
      select set_config('session_replication_role','origin',false);`);
    const input = { email: referredByStaff.email, term: 30, slots: 1, reference: "REFERRED-001" };
    fails(recordSql(admin, input), "42501", /customer you referred/);
    fails(
      staff(admin, `select api.get_staff_invoice_customer('${referredByStaff.email}');`),
      "42501",
      /customer you referred/
    );
    assert.equal(count(`private.payments where owner_id='${referredByStaff.id}'`), 0);
    // Another staff member may record it; the commission goes to the partner as usual.
    const recorded = record(admin2, input);
    assert.equal(recorded.commissions, 1);
  });

  await check("staff see whose account an email names before recording", () => {
    const preview = (who, email) =>
      json(staff(who, `select api.get_staff_invoice_customer(${literal(email)});`));
    assert.deepEqual(preview(admin, thandi.email.toUpperCase()), {
      customer_name: "Fixture t.",
      id_reviewed: true,
      can_use_slots: true,
      slots_held: 2,
      slot_limit: 4,
    });
    const unreviewed = user("preview-unreviewed");
    assert.deepEqual(preview(admin, unreviewed.email), {
      customer_name: "Fixture p.",
      id_reviewed: false,
      can_use_slots: true,
      slots_held: null,
      slot_limit: null,
    });
    fails(
      staff(admin, `select api.get_staff_invoice_customer('nobody@example.invalid');`),
      "PT404"
    );
    fails(staff(admin, `select api.get_staff_invoice_customer('${admin.email}');`), "42501");
    fails(staff(moderator, `select api.get_staff_invoice_customer('${thandi.email}');`), "42501");
    fails(member(thandi, `select api.get_staff_invoice_customer('${thandi.email}');`), "42501");
    fails(staff(admin, "select api.get_staff_invoice_customer(null);"), "22023");
  });

  await check("two staff members recording the same transfer at once: one record", async () => {
    const lebo = verified("lebo");
    const first = session(
      `begin;\n${recordSql(admin, { email: lebo.email, term: 30, slots: 1, reference: "RACE-0001" })}\nselect pg_sleep(1.5);\ncommit;`
    );
    const second = sessionAfter(
      400,
      recordSql(admin2, { email: lebo.email, term: 30, slots: 1, reference: "race 0001" })
    );
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.status, 0, a.stderr);
    assert.notEqual(b.status, 0);
    assert.match(b.stderr, /PT409:.*bank reference was already recorded/);
    assert.equal(count(`private.payments where owner_id='${lebo.id}'`), 1);
  });

  // ------------------------------------------------------------- refunds
  await check("the staff refund commands work on a bank transfer payment", () => {
    const refund = (paymentId, ref) =>
      json(
        staff(
          admin,
          `select api.record_staff_payment_refund('${paymentId}','refunded','billing_error','Refunded by EFT to the payer','${ref}');`
        )
      );
    // One slot of two: that slot and its commission only.
    const line = q(
      `select id from private.payment_lines where payment_id='${thandiPayment}' and line_number=2;`
    );
    const slot = json(
      staff(
        admin,
        `select api.record_staff_slot_refund('${line}','refunded','s14_cancellation','Cancelled within 14 days','EFT-OUT-0001');`
      )
    );
    assert.equal(slot.status, "applied");
    assert.deepEqual(
      json(`select jsonb_agg(jsonb_build_array(l.status,c.status) order by l.line_number)
        from private.payment_lines l join private.partner_commissions c on c.payment_line_id=l.id
        where l.payment_id='${thandiPayment}';`),
      [
        ["open", "pending"],
        ["reversed", "reversed"],
      ]
    );
    fails(
      staff(
        admin,
        `select api.record_staff_payment_refund('${thandiPayment}','refunded','billing_error','Whole order refund','EFT-OUT-0002');`
      ),
      "PT409",
      /refund its other slots one by one/
    );
    // A whole small order: applied at once, slots and commission withdrawn.
    const small = referred("small");
    const smallPayment = record(admin, {
      email: small.email,
      term: 30,
      slots: 1,
      reference: "SMALL-0001",
    }).payment_id;
    assert.equal(refund(smallPayment, "EFT-OUT-0003").status, "applied");
    assert.deepEqual(payment(smallPayment).status, "refunded");
    assert.equal(
      q(`select string_agg(status,',') from private.entitlements where payment_id='${smallPayment}';`),
      "revoked"
    );
    assert.equal(
      q(`select string_agg(status,',') from private.partner_commissions where payment_id='${smallPayment}';`),
      "reversed"
    );
    // The bank reference of a refunded transfer stays used; repeating the
    // request reports the refunded payment instead of recording it again.
    fails(
      recordSql(admin2, { email: small.email, term: 30, slots: 1, reference: "SMALL-0001" }),
      "PT409"
    );
    const repeated = record(admin, {
      email: small.email,
      term: 30,
      slots: 1,
      reference: "SMALL-0001",
    });
    assert.deepEqual(
      [repeated.payment_id, repeated.repeated, repeated.payment_status],
      [smallPayment, true, "refunded"]
    );
    assert.equal(count(`private.payments where owner_id='${small.id}'`), 1);
    // Above R1,000: waits for a second staff member.
    const big = verified("big");
    const bigPayment = record(admin2, {
      email: big.email,
      term: 180,
      slots: 3,
      reference: "BIG-ORDER-0001",
    }).payment_id;
    const waiting = refund(bigPayment, "EFT-OUT-0004");
    assert.equal(waiting.status, "awaiting_approval");
    assert.equal(payment(bigPayment).status, "complete");
    fails(
      staff(admin, `select api.approve_staff_payment_refund('${waiting.request_id}');`),
      "42501",
      /different staff member must approve/
    );
    assert.equal(
      json(staff(admin2, `select api.approve_staff_payment_refund('${waiting.request_id}');`))
        .status,
      "applied"
    );
    assert.equal(payment(bigPayment).status, "refunded");
  });

  await check("bank transfer records and invoice payments keep their rules", () => {
    fails(
      `update private.invoice_payments set reason='Changed later on' where payment_id='${thandiPayment}';`,
      "23514",
      /immutable/
    );
    fails(
      `delete from private.invoice_payments where payment_id='${thandiPayment}';`,
      "23514",
      /immutable/
    );
    // A record must name the invoice payment's own account and amount.
    fails(
      `insert into private.invoice_payments(payment_id,account_id,bank_reference,amount_received_cents,cleared_on,
        cooling_off_waiver_confirmed,reason,recorded_by)
       values('${earlyPayment}','${early.id}','FAKE-0001',6900,current_date,true,'Fake record here','${admin.id}');`,
      "23514",
      /invoice payment's amount/
    );
    // An invoice payment never carries Ozow's fields, and Ozow payments keep theirs.
    fails(
      `update private.payments set provider_transaction_id='tx-fake' where id='${thandiPayment}';`,
      "23514"
    );
    fails(
      `insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,provider,status,
        fulfillment_status,completed_at) values('${early.id}','plan','${P30.id}',6900,'ZAR','{}','ozow','complete','fulfilled',now());`,
      "23514"
    );
    fails(
      `insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,provider,status)
        values('${early.id}','plan','${P30.id}',6900,'ZAR','{}','card','pending');`,
      "23514"
    );
  });

  await check("grants: staff commands for authenticated, the tables closed", () => {
    const grants = json(
      "select jsonb_object_agg(r.rolname||' '||f.sig,has_function_privilege(r.rolname,f.sig,'execute')) " +
        "from (values('anon'),('authenticated'),('service_role')) r(rolname), " +
        `(values('${RECORD}'),('api.get_staff_invoice_payments(uuid[])'),` +
        "('api.get_staff_invoice_customer(text)'),('internal.assert_staff_not_referrer(uuid,uuid)')," +
        "('internal.invoice_payment_guard()')) f(sig);"
    );
    for (const [key, value] of Object.entries(grants)) {
      const [role, sig] = key.split(" ");
      assert.equal(value, role === "authenticated" && sig.startsWith("api."), key);
    }
    assert.equal(
      q(
        "select bool_or(has_table_privilege(r,'private.invoice_payments','select,insert,update,delete')) from unnest(array['anon','authenticated','service_role']) r;"
      ),
      "f"
    );
    fails(asRole("anon", `select ${RECORD.replace(/\(.*$/, "")}(null,30,1,6900,null,null,true,null);`), "42501");
    fails(asRole("service_role", `select api.get_staff_invoice_payments(array[]::uuid[]);`), "42501");
  });

  await check("the rollback refuses once a transfer was recorded", () => {
    const now = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /staff already recorded bank transfers/);
    assert.equal(fingerprint(), now);
    assert.match(
      preflight()[0][1],
      /^staff invoice payments: already applied; payments recorded by bank transfer: [0-9]+$/
    );
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the bank transfer command", () => {
      assert.ok(transfers() > 0);
      assert.equal(
        q(`select has_function_privilege('authenticated','${RECORD}','execute');`),
        "t"
      );
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Staff invoice payment checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
