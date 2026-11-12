#!/usr/bin/env node
// Behaviour checks for 20261111212320_payment_start_retry.sql: a failed first
// call to Ozow never blocks a member from buying a plan (PAY-03, M3.1).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members quote plans with the production checkout command (as
// `authenticated` with synthetic claims and a live session row); the website's
// server leases, attaches and sweeps as `service_role`. A failed call to Ozow is
// a lease that is never completed; "later" is simulated by moving the stored
// times back. The script shows the defect before the update, runs the update's
// read-only preflight, applies the update, checks a retry 31 minutes later and
// the sweep of payments that never got a request, and proves that apply ->
// rollback -> apply returns the schema fingerprint to the same values each
// time. Any later updates are applied at the end and the retry is checked
// again.
//
//   node --import tsx scripts/test-foundation-payment-start-retry.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Members
// are written directly as the database owner. Nothing contacts Ozow: request
// ids and checkout addresses are synthetic.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  assertReadOnlyPreflight,
  createChecks,
  planOnSale,
  sqlHelpers,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261111212320_payment_start_retry.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");
const CLAIM = "internal.claim_checkout_request(uuid,uuid)";
const SWEEP = "expire_stale_checkouts(integer)";

const { check, current, passed: checks } = createChecks();

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);

  // ---------------------------------------------------------------- helpers
  const { q, json, fails, member, service } = sqlHelpers(database, current);
  const as = (role, sql) => `set role ${role};\n${sql}`;
  const fingerprint = () => q(`set search_path to pg_catalog;\n${FINGERPRINT}`);
  const preflight = () =>
    q(PREFLIGHT)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|"));
  const bodyOf = (sig) =>
    q(
      `select coalesce((select md5(replace(prosrc,E'\\r\\n',E'\\n')) from pg_proc where oid=to_regprocedure('${sig}')),'missing');`
    );

  // ------------------------------------------------------- synthetic world
  q(`create schema vmtest;
    create function vmtest.member(p_label text) returns jsonb language plpgsql as $$
    declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(uid,p_label||'-'||uid||'@example.invalid',now(),jsonb_build_object('display_name','Fixture '||p_label));
      insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
      return jsonb_build_object('id',uid,'session',sid);
    end$$;`);
  const user = (label) => json(`select vmtest.member('${label}');`);
  const plan = (code) =>
    q(
      `select id from private.plan_versions where plan_code='${code}' and retired_at is null and is_public order by version desc limit 1;`
    );
  const plans = ["market_30d", "market_90d", "business_30d", "business_90d", "tourism_30d"].map(
    (code) => {
      const id = plan(code);
      assert.match(id, /^[0-9a-f-]{36}$/, `plan ${code}`);
      return id;
    }
  );
  /** The member's quote (the website's first command). */
  const quote = (owner, product) =>
    json(member(owner, `select api.start_checkout('${product}',null);`));
  /** The website's server lease before it calls Ozow. */
  const leaseSql = (owner, paymentId) =>
    service(`select api.claim_checkout_request('${paymentId}','${owner.id}');`);
  const lease = (owner, paymentId) => json(leaseSql(owner, paymentId));
  /** Attaching the request Ozow returned. */
  const attachSql = (owner, paymentId, token, requestId) =>
    service(
      `select api.complete_checkout_request('${paymentId}','${owner.id}',${token ? `'${token}'` : "null"},'${requestId}','https://one.ozow.com/checkout/${requestId}');`
    );
  const row = (paymentId) =>
    json(
      `select jsonb_build_object('status',status,'request',provider_request_id,'key',provider_idempotency_key,` +
        `'expires_at',checkout_expires_at,'expires_in',floor(extract(epoch from checkout_expires_at-clock_timestamp())),'token',checkout_claim_token,` +
        `'leased',checkout_claim_until>clock_timestamp()) from private.payments where id='${paymentId}';`
    );
  /** The stored state without the seconds left, for before/after comparisons. */
  const stored = (paymentId) => {
    const { expires_in: _left, ...rest } = row(paymentId);
    return rest;
  };
  /** "Later": every stored time of the payment moves back. */
  const age = (paymentId, interval) =>
    q(
      `update private.payments set created_at=created_at-interval '${interval}',` +
        `checkout_claim_until=checkout_claim_until-interval '${interval}',` +
        `checkout_expires_at=checkout_expires_at-interval '${interval}' where id='${paymentId}';`
    );
  const sweep = (limit = 100) =>
    Number(q(service(`select api.${SWEEP.replace("integer", limit)};`)));

  /** A failed first attempt: quoted and leased, and the call to Ozow failed,
   * so nothing was attached. */
  const failedStart = (label, product) => {
    const owner = user(label);
    const quoted = quote(owner, product);
    const leased = lease(owner, quoted.payment_id);
    assert.equal(leased.provider_request_id, null);
    assert.equal(leased.checkout_url, null);
    return { owner, id: quoted.payment_id, leased };
  };

  // ------------------------------------------------------------ before
  await check("before the update: a retry 31 minutes later reuses the dead window and key", () => {
    assert.equal(bodyOf(`api.${SWEEP}`), "missing");
    const first = failedStart("before", plans[0]);
    age(first.id, "31 minutes");
    const again = quote(first.owner, plans[0]);
    assert.equal(again.payment_id, first.id);
    assert.equal(again.reused, true);
    const retried = lease(first.owner, first.id);
    assert.equal(retried.idempotency_key, first.leased.idempotency_key);
    assert.ok(Date.parse(retried.checkout_expires_at) < Date.now(), "the window had ended");
    fails(service(`select api.${SWEEP.replace("integer", "10")};`), "42883");
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^payment start retry: reviewed bodies, update not applied \(apply before the website release that uses it is deployed\); pending without an Ozow request: 1; of which the sweep will expire: 0$/
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    const live = q(`select pg_get_functiondef('${CLAIM}'::regprocedure);`);
    // The same function with one more space at the start of its body.
    q(
      `do $$begin execute replace(pg_get_functiondef('${CLAIM}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[1][1], /is not the reviewed body/);
    assert.match(fails(step.sql, "55000"), /checkout lease drift/);
    q(`${live};`);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  const before = fingerprint();
  applySteps(database, [step]);
  const after = fingerprint();

  /** The check M3.1 names: the first call fails; a retry 31 minutes later
   * gets a fresh expiry and a new request key; the earlier lease cannot
   * attach anything. */
  const retryLater = (label, product) => {
    const first = failedStart(label, product);
    const created = q(
      `select provider_idempotency_key from private.payments where id='${first.id}';`
    );
    // The first lease keeps the key the payment was created with.
    assert.equal(first.leased.idempotency_key, created);
    assert.ok(row(first.id).expires_in > 29 * 60);
    // While that lease runs nobody else may call Ozow for this payment.
    fails(leaseSql(first.owner, first.id), "PT409", /checkout is being created/);
    age(first.id, "31 minutes");
    const again = quote(first.owner, product);
    assert.equal(again.payment_id, first.id, "the same pending payment is reused");
    const retried = lease(first.owner, first.id);
    assert.notEqual(retried.idempotency_key, first.leased.idempotency_key);
    assert.notEqual(retried.claim_token, first.leased.claim_token);
    assert.equal(retried.correlation_id, first.leased.correlation_id);
    const now = row(first.id);
    assert.ok(now.expires_in > 29 * 60 && now.expires_in <= 30 * 60, JSON.stringify(now));
    assert.equal(now.key, retried.idempotency_key);
    assert.equal(now.leased, true);
    // A late answer to the failed attempt cannot attach its request.
    fails(
      attachSql(first.owner, first.id, first.leased.claim_token, `stale-${first.id}`),
      "PT409",
      /checkout claim superseded/
    );
    assert.equal(q(attachSql(first.owner, first.id, retried.claim_token, `req-${first.id}`)), "t");
    // From now on the payment keeps its request, key and window.
    const attached = stored(first.id);
    const reread = lease(first.owner, first.id);
    assert.equal(reread.provider_request_id, `req-${first.id}`);
    assert.equal(reread.claim_token, retried.claim_token);
    assert.equal(reread.idempotency_key, retried.idempotency_key);
    assert.deepEqual(stored(first.id), attached);
    return first;
  };

  await check(
    "after the update: a retry 31 minutes later gets a fresh window and a new key",
    () => {
      assert.notEqual(after, before);
      assert.match(preflight()[0][1], /^payment start retry: already applied; /);
      assert.equal(preflight().length, 1);
      retryLater("retry", plans[1]);
      // Every new lease after a failed one moves on; one taken right after the
      // earlier lease ran out (no 31 minutes) too.
      const quick = failedStart("quick", plans[2]);
      q(
        `update private.payments set checkout_claim_until=clock_timestamp()-interval '1 second' where id='${quick.id}';`
      );
      const next = lease(quick.owner, quick.id);
      assert.notEqual(next.idempotency_key, quick.leased.idempotency_key);
      assert.ok(row(quick.id).expires_in > 29 * 60);
    }
  );

  await check("an attached request is never re-leased, even after its window", () => {
    const owner = user("attached");
    const quoted = quote(owner, plans[3]);
    const leased = lease(owner, quoted.payment_id);
    q(attachSql(owner, quoted.payment_id, leased.claim_token, `req-${quoted.payment_id}`));
    age(quoted.payment_id, "2 hours");
    const before = stored(quoted.payment_id);
    const again = lease(owner, quoted.payment_id);
    assert.equal(again.claim_token, leased.claim_token);
    assert.equal(again.checkout_url, `https://one.ozow.com/checkout/req-${quoted.payment_id}`);
    assert.deepEqual(stored(quoted.payment_id), before);
    // The sweep leaves it to the status check.
    sweep();
    assert.equal(row(quoted.payment_id).status, "pending");
  });

  await check("the sweep expires stale pending payments that never got a request", () => {
    const stale = failedStart("stale", plans[0]);
    age(stale.id, "61 minutes");
    const unleased = user("unleased");
    const unleasedId = quote(unleased, plans[0]).payment_id;
    q(
      `update private.payments set created_at=created_at-interval '2 hours' where id='${unleasedId}';`
    );
    // Young, leased right now, or with a request: left alone.
    const young = failedStart("young", plans[0]);
    age(young.id, "50 minutes");
    const busy = failedStart("busy", plans[0]);
    q(
      `update private.payments set created_at=created_at-interval '3 hours' where id='${busy.id}';`
    );
    const settledOwner = user("settled");
    const settled = quote(settledOwner, plans[0]).payment_id;
    q(
      `update private.payments set status='failed',created_at=created_at-interval '3 hours' where id='${settled}';`
    );
    const others = Number(
      q(
        "select count(*) from private.payments where status='pending' and provider_request_id is null " +
          "and created_at<clock_timestamp()-interval '1 hour' and (checkout_claim_until is null or checkout_claim_until<=clock_timestamp());"
      )
    );
    assert.ok(others >= 2, `${others}`);
    // The limit holds: oldest first.
    assert.equal(sweep(1), 1);
    assert.equal(sweep(), others - 1);
    for (const id of [stale.id, unleasedId]) {
      const now = row(id);
      assert.equal(now.status, "expired", id);
      assert.equal(now.request, null);
    }
    assert.equal(row(young.id).status, "pending");
    assert.equal(row(busy.id).status, "pending");
    assert.equal(row(settled).status, "failed");
    assert.equal(
      q(
        `select status_changed_at>clock_timestamp()-interval '1 minute' from private.payments where id='${stale.id}';`
      ),
      "t"
    );
    // Safe to repeat: nothing more to do.
    assert.equal(sweep(), 0);
    assert.equal(sweep(500), 0);
    // A lease can no longer be taken on the expired payment, and the member's
    // next checkout starts a new one that works.
    fails(leaseSql(stale.owner, stale.id), "PT409", /pending checkout unavailable/);
    const fresh = quote(stale.owner, plans[0]);
    assert.notEqual(fresh.payment_id, stale.id);
    assert.equal(fresh.reused, false);
    const freshLease = lease(stale.owner, fresh.payment_id);
    assert.ok(row(fresh.payment_id).expires_in > 29 * 60);
    assert.equal(
      q(
        attachSql(stale.owner, fresh.payment_id, freshLease.claim_token, `req-${fresh.payment_id}`)
      ),
      "t"
    );
    // The busy one's lease runs out; the next run closes it.
    q(
      `update private.payments set checkout_claim_until=clock_timestamp()-interval '1 second' where id='${busy.id}';`
    );
    assert.equal(sweep(), 1);
    assert.equal(row(busy.id).status, "expired");
  });

  await check("the sweep refuses a bad limit and only the website's server may run it", () => {
    for (const limit of ["0", "501", "null", "-1"])
      fails(
        service(`select api.expire_stale_checkouts(${limit});`),
        "22023",
        /invalid checkout sweep limit/
      );
    const someone = user("someone");
    fails(member(someone, "select api.expire_stale_checkouts(10);"), "42501");
    fails(as("anon", "select api.expire_stale_checkouts(10);"), "42501");
    const grants = json(
      "select jsonb_object_agg(r.rolname||' '||f.sig,has_function_privilege(r.rolname,f.sig,'execute')) " +
        "from (values('anon'),('authenticated'),('service_role')) r(rolname), " +
        "(values('api.expire_stale_checkouts(integer)'),('internal.expire_stale_checkouts(integer)'),('internal.claim_checkout_request(uuid,uuid)')) f(sig);"
    );
    assert.deepEqual(grants, {
      "anon api.expire_stale_checkouts(integer)": false,
      "anon internal.expire_stale_checkouts(integer)": false,
      "anon internal.claim_checkout_request(uuid,uuid)": false,
      "authenticated api.expire_stale_checkouts(integer)": false,
      "authenticated internal.expire_stale_checkouts(integer)": false,
      "authenticated internal.claim_checkout_request(uuid,uuid)": false,
      "service_role api.expire_stale_checkouts(integer)": true,
      "service_role internal.expire_stale_checkouts(integer)": true,
      "service_role internal.claim_checkout_request(uuid,uuid)": true,
    });
    // Members cannot lease their own payment either (only the server can).
    const owner = user("direct");
    const quoted = quote(owner, plans[4]);
    fails(
      member(owner, `select api.claim_checkout_request('${quoted.payment_id}','${owner.id}');`),
      "42501"
    );
    // Nor can the server lease it for another account.
    fails(leaseSql(someone, quoted.payment_id), "PT409", /pending checkout unavailable/);
    assert.equal(
      q(
        `select security_definer::text||' '||array_to_string(p.proconfig,',') from (select prosecdef as security_definer, proconfig from pg_proc where oid=to_regprocedure('internal.${SWEEP}')) p;`
      ),
      "true search_path=pg_catalog"
    );
  });

  await check("apply, roll back and apply again are clean", () => {
    applySteps(database, [{ label: "payment start retry rollback", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before, "the rollback leaves the pre-update schema");
    assert.equal(bodyOf(`api.${SWEEP}`), "missing");
    assert.match(preflight()[0][1], /^payment start retry: reviewed bodies, update not applied/);
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
    retryLater("reapplied", plans[4]);
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the retry and the sweep", () => {
      // The switch to posting-v4 takes the plans off sale: buy copies instead.
      const [laterPlan, retryPlan] = [plans[2], plans[3]].map((id) => planOnSale(q, id));
      const first = failedStart("later", laterPlan);
      age(first.id, "2 hours");
      assert.ok(sweep() >= 1);
      assert.equal(row(first.id).status, "expired");
      retryLater(`later-${randomUUID().slice(0, 8)}`, retryPlan);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Payment start retry checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
