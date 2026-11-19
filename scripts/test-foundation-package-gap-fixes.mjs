#!/usr/bin/env node
// Behaviour checks for 20261119151152_package_gap_fixes.sql: the small gaps of
// Multi-listing packages, part one (roadmap P4a; the owner's decision D6).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members buy with the production checkouts (as `authenticated` with
// synthetic claims and a live session row); the website's server leases,
// attaches and settles as `service_role` with synthetic Ozow ids; staff act
// with a verified authenticator app and an AAL2 session. Time is moved by
// shifting a member's own dates back (vmtest.travel). The only stand-in is
// internal.current_verified_identity (the member's current accepted fact). The
// sales switch is turned on the way the owner would: one SQL statement.
//
// It checks the read-only preflight, drifted bodies and a premature rollback,
// applies the update and proves apply -> rollback -> apply, then: the grants;
// a package move that fails is recorded (tries, first and last failure,
// reason), counted again on the next run, reported stuck after 30 minutes and
// listed for staff with payments:view only, and the record goes once the post
// moves; a post another transaction holds is recorded as busy, without the
// sweep waiting; a failure in the package's last day is stuck at once; a paused
// post whose end date was raised to the package's goes back to its slot's end
// when the package is refunded, and then expires with the 3-day grace; a post
// saved under rules that have since changed never stops the refund and is put
// back by the sweep once it can be; a bank transfer to an Individual invoice
// issued before the package started is recorded and delivered beside the
// package, while one issued after it (and a transfer without an invoice) is
// still refused; an unsent online package checkout cannot be sent to Ozow
// while a package invoice is unpaid or once a package runs, while the
// invoice's own Pay now attempt can; a package checkout is refused at once,
// never waited for, while another transaction holds the account's package
// lock; and later updates keep the record.
//
//   node --import tsx scripts/test-foundation-package-gap-fixes.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
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
  assertDriftRefused,
  createPaymentWorld,
  P30,
  psqlSessions,
  sha,
  sqlValue,
  twoAdmins,
  updateCheckKit,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261119151152_package_gap_fixes.sql";
/** The Multi-listing package terms (20261114154823_slot_packages.sql). */
const K30 = { id: "5b0f4c1e-2a7d-4c43-9b51-7e0d3f6a9c11", days: 30, cents: 10000 };
const READ = "api.get_staff_package_move_failures()";
const HELPERS = [
  "internal.get_staff_package_move_failures()",
  "internal.slot_package_move_failed(uuid,uuid,text,text)",
  "internal.slot_package_move_stuck(timestamp with time zone,timestamp with time zone)",
  "internal.slot_package_release_paused(uuid)",
  "internal.slot_package_blocks_invoice(text,uuid,timestamp with time zone)",
];
const REPLACED = [
  "internal.run_slot_renewals(integer)",
  "internal.slot_package_grant_revoked()",
  "internal.claim_checkout_request(uuid,uuid)",
  "internal.record_staff_invoice_transfer(text,text,text,boolean,text)",
  "internal.confirm_staff_invoice_payment(uuid)",
];

const started = Date.now();
const { check, current, passed: checks } = createChecks();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const kit = updateCheckKit(database, UPDATE, current);
  const { q, json, fails, count, member, staff, service, preflight } = kit;
  const world = createPaymentWorld(kit);
  const { session } = psqlSessions(database);
  const { admin, admin2 } = twoAdmins(world, "gaps");
  const moderator = world.staffUser("gaps-moderator", "moderator");
  world.review(moderator, admin, "gaps-moderator");
  const verified = (label) => world.verified(label, admin);
  const scalar = (sql) => q(sql);
  const truth = (sql) => scalar(`select (${sql});`) === "t";
  const same = (a, b) => truth(`'${a}'::timestamptz='${b}'::timestamptz`);
  const today = q("select to_char((now() at time zone 'Africa/Johannesburg')::date,'YYYY-MM-DD');");

  // Days pass for one member: every date of their slots, activations, posts,
  // search documents and finished payments moves back by p_by.
  q(`create function vmtest.travel(p_owner uuid,p_by interval) returns void language plpgsql as $$
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
      update private.slot_packages set created_at=created_at-p_by where owner_id=p_owner;
      perform set_config('session_replication_role','origin',true);
    end$$;
    create table vmtest.gate(name text primary key);`);
  const travel = (owner, by) => q(`select vmtest.travel('${owner.id}','${by}'::interval);`);
  const post = (owner) => world.post(owner, "listing", "market");
  const onSale = (value) =>
    q(
      `update private.slot_package_sales set on_sale=${value},changed_at=now(),reason='Fixture: switched for the checks';`
    );

  const lease = (owner, paymentId) =>
    service(`select api.claim_checkout_request('${paymentId}','${owner.id}');`);
  const open = (owner, paymentId) => {
    const leased = json(lease(owner, paymentId));
    if (leased.checkout_url) return leased;
    q(
      service(
        `select api.complete_checkout_request('${paymentId}','${owner.id}','${leased.claim_token}','req-${paymentId}','https://one.ozow.com/checkout/req-${paymentId}');`
      )
    );
    return leased;
  };
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
  const packageCheckout = (owner, plan, slots) =>
    json(
      member(
        owner,
        `select api.start_package_checkout('${plan.id}',${slots},${plan.cents * slots},true);`
      )
    );
  const buyPackage = (owner, plan, slots) => {
    const quoted = packageCheckout(owner, plan, slots);
    const settled = settle(owner, quoted.payment_id);
    assert.equal(settled.fulfillment_status, "fulfilled", JSON.stringify(settled));
    return quoted.payment_id;
  };
  const buySlot = (owner) => {
    const quoted = json(
      member(owner, `select api.start_slot_checkout('${P30.id}',1,${P30.cents},true);`)
    );
    assert.equal(settle(owner, quoted.payment_id).outcome, "completed");
    return quoted.payment_id;
  };
  /** A 5-slot package for 30 days (online: within Ozow's maximum) bought 10
   * days into the member's Individual slots; then their slots end, with the
   * package's last 10 days still to run. Returns the package payment. */
  const packageThenSlotsEnd = (owner) => {
    travel(owner, "10 days");
    const paymentId = buyPackage(owner, K30, 5);
    travel(owner, "20 days 1 second");
    return paymentId;
  };
  const grantOf = (paymentId) =>
    json(`select jsonb_build_object('id',e.id,'line',l.id,'starts',e.starts_at,'ends',e.ends_at,
        'package',e.package_id,'status',e.status)
      from private.payment_lines l left join private.entitlements e on e.payment_line_id=l.id
      where l.payment_id='${paymentId}' and l.line_number=1;`);
  const live = (owner, id) => {
    json(member(owner, `select api.activate_post('${id}');`));
    q(`update private.posts set status='live',published_at=now(),
         visible_until=(select f.funded_until from internal.post_funding('${id}') f) where id='${id}';
       select internal.write_post_projection('${id}');`);
  };
  const inPackage = (id) =>
    truth(`exists(select 1 from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
      where a.post_id='${id}' and a.released_at is null and e.package_id is not null)`);
  const postUntil = (id) => scalar(`select visible_until from private.posts where id='${id}';`);
  const sweep = () => json(service("select api.run_slot_renewals(100);"));
  const lifecycle = () => json(service("select api.run_post_lifecycle(100);"));
  const failures = (who = admin) => json(staff(who, `select ${READ};`)).items;
  const record = (packageId) =>
    json(`select coalesce(jsonb_agg(to_jsonb(f) order by f.direction, f.post_id),'[]'::jsonb)
      from private.slot_package_move_failures f where f.package_id='${packageId}';`);
  /** A fault on the moves of one post (a stand-in for anything unexpected). */
  const refuseMoves = (postId) =>
    q(`create or replace function vmtest.refuse_move() returns trigger language plpgsql as $f$ begin
         if new.post_id='${postId}' and new.continued then raise exception 'fixture: this move fails'; end if;
         return new; end $f$;
       create trigger vmtest_refuse_move before insert on private.post_activations
         for each row execute function vmtest.refuse_move();`);
  const allowMoves = () =>
    q(
      "drop trigger vmtest_refuse_move on private.post_activations; drop function vmtest.refuse_move();"
    );
  const until = async (sql, what) => {
    for (let i = 0; i < 1200; i++) {
      if (q(sql) === "t") return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`[${current()}] timed out waiting for ${what}`);
  };
  /** Runs `sql` in a transaction of another session named `name`, which stays
   * open (holding its locks) until the gate `name` opens. */
  const hold = async (name, sql) => {
    const done = session(
      `begin;\nset local application_name='${name}';\n${sql}\ndo $$begin for i in 1..6000 loop exit when exists(select 1 from vmtest.gate where name='${name}'); perform pg_sleep(0.01); end loop; end$$;\ncommit;`
    );
    await until(
      `select exists(select 1 from pg_stat_activity where application_name='${name}' and query like 'do $$begin for i%');`,
      `${name} to hold its locks`
    );
    // An object, so awaiting hold() does not wait for the session to end.
    return { done };
  };
  const openGate = (name) => q(`insert into vmtest.gate(name) values('${name}');`);

  // Invoices: an Individual invoice issued by staff, a bank transfer recorded
  // by one staff member and confirmed by another.
  const issueIndividual = (owner) =>
    json(
      staff(
        admin,
        `select api.issue_staff_invoice(${sqlValue(owner.email)},30,1,7,'Invoice asked for by email','${randomUUID()}');`
      )
    );
  const transferSql = (who, invoiceNumber, reference) =>
    staff(
      who,
      `select api.record_staff_invoice_transfer(${sqlValue(invoiceNumber)},${sqlValue(reference)},'${today}',true,'EFT cleared; customer agreed in writing');`
    );
  const confirm = (who, transferId) =>
    json(staff(who, `select api.confirm_staff_invoice_payment('${transferId}');`));

  // ------------------------------------------------------------ before
  await check("before the update: the preflight reads 'not applied'; the read is absent", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      "package gap fixes: update not applied; on sale: no; packages: 0; paused posts to put back: 0; unsent package checkouts to refuse: 0; unpaid Individual invoices issued before a package: 0; move record: none (table absent)"
    );
    assertReadOnlyPreflight(database, kit.preflightSql);
    fails(staff(admin, `select ${READ};`), "42883");
  });

  await check("the update and a premature rollback refuse drifted bodies, changing nothing", () =>
    assertDriftRefused(kit, { label: "package gap fixes", signatures: REPLACED, rows: 2 })
  );

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: UPDATE,
    applied:
      /^package gap fixes: already applied; on sale: no; packages: 0; paused posts to put back: 0; unsent package checkouts to refuse: 0; unpaid Individual invoices issued before a package: 0; move record: 0$/,
    notApplied: /^package gap fixes: update not applied/,
  });

  await check("grants: staff call the read; nobody calls the helpers or reads the table", () => {
    const grants = executeGrants(json, [READ, ...HELPERS]);
    assert.deepEqual(grants[READ], { anon: false, authenticated: true, service_role: false });
    for (const helper of HELPERS)
      assert.deepEqual(
        grants[helper],
        {
          anon: false,
          authenticated: helper === "internal.get_staff_package_move_failures()",
          service_role: false,
        },
        helper
      );
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        q(
          `select has_table_privilege('${role}','private.slot_package_move_failures','select,insert,update,delete');`
        ),
        "f"
      );
    assert.equal(
      q(
        "select relrowsecurity from pg_class where oid='private.slot_package_move_failures'::regclass;"
      ),
      "t"
    );
  });

  onSale(true);

  // ------------------------------------------- 1. the record of failed moves
  await check(
    "a failed move is recorded, counted again, reported stuck after 30 minutes and cleared when it moves",
    () => {
      const ayanda = verified("gaps-ayanda");
      buySlot(ayanda);
      buySlot(ayanda);
      const listings = [post(ayanda), post(ayanda)];
      for (const id of listings) live(ayanda, id);
      const paymentId = packageThenSlotsEnd(ayanda);
      const packageId = grantOf(paymentId).package;
      refuseMoves(listings[1]);
      try {
        const first = sweep();
        assert.equal(first.package_skipped, 1, JSON.stringify(first));
        assert.equal(first.package_stuck, 0);
        assert.deepEqual(first.package_stuck_moves, []);
        assert.ok(inPackage(listings[0]), "the other post still moves");
        let [row] = record(packageId);
        assert.equal(row.post_id, listings[1]);
        assert.equal(row.direction, "into_package");
        assert.equal(row.tries, 1);
        assert.equal(row.reason, "error P0001");
        assert.ok(same(row.first_failed_at, row.last_failed_at));
        // The next run counts it again on the same row.
        sweep();
        [row] = record(packageId);
        assert.equal(row.tries, 2);
        assert.equal(record(packageId).length, 1);
        // Staff with payments:view see it, not yet stuck; nobody else does.
        const [listed] = failures();
        assert.equal(listed.post_id, listings[1]);
        assert.equal(listed.package_id, packageId);
        // The public short name, never the email.
        assert.ok(
          listed.owner_name === null || /^Fixture \S+\.$/.test(listed.owner_name),
          listed.owner_name
        );
        assert.match(listed.post_title, /^Fixture listing /);
        assert.equal(listed.stuck, false);
        assert.ok(listed.package_ends_at);
        assert.equal(listed.customer_email, undefined, "no contact details");
        fails(staff(moderator, `select ${READ};`), "42501");
        fails(member(ayanda, `select ${READ};`), "42501");
        fails(kit.asRole("anon", `select ${READ};`), "42501");
        // Failing for over 30 minutes: stuck, in the sweep's reply and for staff.
        q(`update private.slot_package_move_failures set first_failed_at=first_failed_at-interval '31 minutes'
           where package_id='${packageId}';`);
        const stuck = sweep();
        assert.equal(stuck.package_stuck, 1, JSON.stringify(stuck));
        assert.equal(stuck.package_stuck_moves.length, 1);
        assert.deepEqual(Object.keys(stuck.package_stuck_moves[0]).sort(), [
          "direction",
          "first_failed_at",
          "package_id",
          "post_id",
          "reason",
          "tries",
        ]);
        assert.equal(stuck.package_stuck_moves[0].tries, 3);
        assert.equal(failures()[0].stuck, true);
        // A failure 15 minutes after the last one starts the count again.
        q(`update private.slot_package_move_failures set last_failed_at=last_failed_at-interval '16 minutes',
             first_failed_at=first_failed_at-interval '16 minutes' where package_id='${packageId}';`);
        assert.deepEqual(failures(), [], "not current");
        assert.equal(sweep().package_stuck, 0);
        [row] = record(packageId);
        assert.equal(row.tries, 1);
      } finally {
        allowMoves();
      }
      const moved = sweep();
      assert.equal(moved.package_skipped, 0);
      assert.ok(inPackage(listings[1]), "the next run moves it");
      assert.deepEqual(record(packageId), [], "the record goes once it moved");
      assert.deepEqual(failures(), []);
    }
  );

  await check(
    "a post another transaction holds is recorded as busy; the sweep does not wait",
    async () => {
      const bheki = verified("gaps-bheki");
      buySlot(bheki);
      const listing = post(bheki);
      live(bheki, listing);
      const packageId = grantOf(packageThenSlotsEnd(bheki)).package;
      const holder = await hold(
        "gaps-post-holder",
        `select 1 from private.posts where id='${listing}' for update;`
      );
      try {
        assert.equal(
          q(
            `select count(*) from (select 1 from private.posts where id='${listing}' for update skip locked) x;`
          ),
          "0",
          "the other session holds the post"
        );
        const result = sweep();
        assert.equal(result.package_skipped, 1, JSON.stringify(result));
        const [row] = record(packageId);
        assert.equal(row.reason, "busy");
        assert.equal(row.post_id, listing);
        assert.equal(inPackage(listing), false);
      } finally {
        openGate("gaps-post-holder");
      }
      assert.equal((await holder.done).status, 0);
      sweep();
      assert.ok(inPackage(listing));
      assert.deepEqual(record(packageId), []);
    }
  );

  await check("in the package's last day a failing move is stuck at once", () => {
    const zanele = verified("gaps-zanele");
    const paymentId = buyPackage(zanele, K30, 5);
    const packageId = grantOf(paymentId).package;
    const listing = post(zanele);
    live(zanele, listing);
    // The package ends in 20 hours; a free Individual slot runs beyond it.
    travel(zanele, "29 days 4 hours");
    buySlot(zanele);
    refuseMoves(listing);
    try {
      const result = sweep();
      assert.equal(result.package_skipped, 1, JSON.stringify(result));
      assert.equal(result.package_stuck, 1);
      const [row] = record(packageId);
      assert.equal(row.direction, "out_of_package");
      assert.equal(failures().find((f) => f.post_id === listing).stuck, true);
    } finally {
      allowMoves();
    }
    assert.equal(sweep().package_downsized, 1);
    assert.equal(inPackage(listing), false);
    assert.deepEqual(record(packageId), []);
  });

  // ---------------------------------- 3. paused posts after a package refund
  const refund = (paymentId) =>
    q(
      `select internal.reverse_payment_line('${grantOf(paymentId).line}','refunded','Billing error on the package','${admin.id}');`
    );
  await check(
    "a refund puts a paused post back to its slot's end; it then expires with the 3-day grace",
    () => {
      const ntombi = verified("gaps-ntombi");
      const slot = buySlot(ntombi);
      const listing = post(ntombi);
      live(ntombi, listing);
      const paymentId = packageThenSlotsEnd(ntombi);
      // The lifecycle job raises its end date to the package's (it is taken);
      // then the member pauses it.
      lifecycle();
      assert.ok(same(postUntil(listing), grantOf(paymentId).ends));
      q(`update private.posts set status='paused' where id='${listing}';`);
      refund(paymentId);
      assert.ok(same(postUntil(listing), grantOf(slot).ends), "back to its own end");
      lifecycle();
      assert.equal(scalar(`select status from private.posts where id='${listing}';`), "expired");
      assert.ok(
        truth(
          `(select deletes_at from private.posts where id='${listing}')<=now()+interval '3 days 1 minute'`
        )
      );
    }
  );

  await check(
    "a paused post saved under rules that have since changed never stops the refund; the sweep puts it back later",
    () => {
      const ayo = verified("gaps-ayo");
      const slot = buySlot(ayo);
      const listing = post(ayo);
      live(ayo, listing);
      const paymentId = packageThenSlotsEnd(ayo);
      lifecycle();
      q(`update private.posts set status='paused' where id='${listing}';`);
      q(`set session_replication_role=replica;
        update private.listing_details set attributes='{"retired_field":"x"}'::jsonb where post_id='${listing}';`);
      refund(paymentId);
      assert.equal(grantOf(paymentId).status, "revoked");
      assert.ok(same(postUntil(listing), grantOf(paymentId).ends), "left as it was");
      assert.equal(sweep().package_paused_released, 0, "still refused");
      q(`set session_replication_role=replica;
        update private.listing_details set attributes='{}'::jsonb where post_id='${listing}';`);
      assert.equal(sweep().package_paused_released, 1);
      assert.ok(same(postUntil(listing), grantOf(slot).ends));
    }
  );

  // ------------------- 4. bank transfers for invoices issued before a package
  await check(
    "a bank transfer to an Individual invoice issued before the package is recorded and delivered beside it",
    () => {
      const lerato = verified("gaps-lerato");
      const before = issueIndividual(lerato);
      // No invoice can be issued while the package runs (E3): this one is
      // issued now and dated after the package started below.
      const after = issueIndividual(lerato);
      const paymentId = buyPackage(lerato, K30, 5);
      q(`set session_replication_role=replica;
        update private.customer_invoices set issued_at=now()+interval '1 second'
        where invoice_number='${after.invoice_number}';`);
      assert.match(
        preflight()[0][1],
        /; unpaid Individual invoices issued before a package: 1; /,
        "the preflight counts the invoice issued before the package"
      );
      // Issued after the package started: still refused (E3).
      fails(transferSql(admin, after.invoice_number, "EFT-AFTER-1"), "PT409", /package_active/);
      const recorded = json(transferSql(admin, before.invoice_number, "EFT-BEFORE-1"));
      assert.equal(recorded.status, "awaiting_confirmation");
      const confirmed = confirm(admin2, recorded.transfer_id);
      assert.equal(confirmed.slots_started, 1);
      assert.equal(
        q(
          `select status from private.customer_invoices where invoice_number='${before.invoice_number}';`
        ),
        "paid"
      );
      // The slot runs beside the package, to its own end.
      const slot =
        json(`select jsonb_build_object('package',e.package_id,'days',extract(day from e.ends_at-e.starts_at)::integer)
        from private.entitlements e join private.payments p on p.id=e.payment_id
        where p.snapshot->>'customer_invoice_number'='${before.invoice_number}';`);
      assert.deepEqual(slot, { package: null, days: 30 });
      assert.equal(grantOf(paymentId).status, "active");
      // A transfer recorded without an invoice is still refused while the package runs.
      fails(
        staff(
          admin,
          `select api.record_staff_invoice_payment(${sqlValue(lerato.email)},30,1,6900,'EFT-NOINV-1','${today}',true,'EFT cleared; customer agreed in writing');`
        ),
        "PT409",
        /package_active/
      );
    }
  );

  // ------------------------------- 5. unsent online package checkouts
  await check(
    "an unsent package checkout is not sent beside an unpaid package invoice or a package; the invoice's own attempt is",
    () => {
      const sipho = verified("gaps-sipho");
      const unsent = packageCheckout(sipho, K30, 5).payment_id;
      const invoiceFor = () => {
        const asked = json(
          member(
            sipho,
            `select api.request_package_invoice('${K30.id}',5,${K30.cents * 5},true,'${randomUUID()}');`
          )
        );
        return json(
          staff(
            admin,
            `select api.issue_staff_package_invoice('${asked.request_id}',7,'Invoice asked for at checkout');`
          )
        ).invoice;
      };
      const invoice = invoiceFor();
      fails(lease(sipho, unsent), "PT409", /package_invoice_unpaid/);
      // Pay now on the invoice closes the unsent checkout; its own attempt is sent.
      const invoiceRow = json(
        member(sipho, `select api.get_my_invoice('${invoice.invoice_number}');`)
      );
      json(
        member(
          sipho,
          `select api.save_my_invoice_billing('${invoice.invoice_number}',${invoiceRow.revision},'Fixture Motors (Pty) Ltd','1 Example Road\nEmpangeni\n3880',null);`
        )
      );
      const attempt = json(
        member(
          sipho,
          `select api.start_invoice_payment('${invoice.invoice_number}',${invoice.total_cents},true);`
        )
      );
      assert.equal(q(`select status from private.payments where id='${unsent}';`), "cancelled");
      assert.ok(json(lease(sipho, attempt.payment_id)).claim_token);

      // Another member: an unsent online checkout, then a package paid by
      // bank transfer to its invoice.
      const thandi = verified("gaps-thandi");
      const waiting = packageCheckout(thandi, K30, 5).payment_id;
      const asked = json(
        member(
          thandi,
          `select api.request_package_invoice('${K30.id}',5,${K30.cents * 5},true,'${randomUUID()}');`
        )
      );
      const issued = json(
        staff(
          admin,
          `select api.issue_staff_package_invoice('${asked.request_id}',7,'Invoice asked for at checkout');`
        )
      ).invoice;
      const recorded = json(transferSql(admin, issued.invoice_number, "EFT-PKG-THANDI"));
      assert.equal(confirm(admin2, recorded.transfer_id).slots_started, 5);
      assert.equal(count(`private.slot_packages where owner_id='${thandi.id}'`), 1);
      fails(lease(thandi, waiting), "PT409", /package_active/);
      assert.equal(
        q(`select checkout_url is null from private.payments where id='${waiting}';`),
        "t"
      );
    }
  );

  await check(
    "while the account's package lock is held, a package checkout is refused at once, never waited for",
    async () => {
      const ayanda = verified("gaps-busy");
      const unsent = packageCheckout(ayanda, K30, 5).payment_id;
      const holder = await hold(
        "gaps-package-lock",
        `select pg_advisory_xact_lock(hashtextextended('slot-package:${ayanda.id}',707));`
      );
      try {
        const before = Date.now();
        fails(lease(ayanda, unsent), "PT409", /package_busy/);
        assert.ok(Date.now() - before < 10_000, "the claim did not wait");
      } finally {
        openGate("gaps-package-lock");
      }
      assert.equal((await holder.done).status, 0);
      assert.ok(json(lease(ayanda, unsent)).claim_token, "sent once the lock is free");
    }
  );

  await check("the preflight counts the record; the rollback refuses another body", () => {
    assert.match(
      preflight()[0][1],
      /^package gap fixes: already applied; on sale: yes; packages: [1-9]\d*; paused posts to put back: 0; unsent package checkouts to refuse: [1-9]\d*; unpaid Individual invoices issued before a package: \d+; move record: \d+$/
    );
    const live = q(`select pg_get_functiondef('${REPLACED[0]}'::regprocedure);`);
    q(
      `do $$begin execute replace(pg_get_functiondef('${REPLACED[0]}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    assert.match(fails(kit.rollbackSql, "55000"), /rollback precondition/);
    q(`${live};`);
  });

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the record of failed moves", () => {
      assert.deepEqual(failures(), []);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Package gap checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
