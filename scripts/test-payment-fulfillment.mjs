// Isolated PostgreSQL semantics checks. No environment loading, sockets or remote DB.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite();
const initial = fs.readFileSync("supabase/migrations/20240101000000_initial_schema.sql", "utf8");
const definition = (pattern) => {
  const match = initial.match(pattern);
  assert(match, `Missing schema definition ${pattern}`);
  return match[0];
};
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
  ${[
    "marketplace_area",
    "plan_tier",
    "entitlement_type",
    "entitlement_status",
    "payment_status",
    "user_role",
  ]
    .map((type) => definition(new RegExp(`CREATE TYPE ${type} AS ENUM \\([\\s\\S]*?;`)))
    .join("\n")}
  ${["plans", "entitlements", "payments", "invoices", "audit_logs"]
    .map((table) => definition(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`)))
    .join("\n")}
  ALTER TYPE entitlement_status ADD VALUE 'pending_verification';
  ALTER TYPE plan_tier ADD VALUE 'basic';
  ALTER TYPE user_role ADD VALUE 'member';
  CREATE TABLE account_profiles(user_id uuid PRIMARY KEY, account_status text);
  CREATE TABLE listings(id uuid PRIMARY KEY, owner_id uuid, boost_until timestamptz, featured_until timestamptz, urgent_until timestamptz);
  CREATE TABLE businesses(LIKE listings INCLUDING ALL);
  CREATE TABLE promotions(LIKE listings INCLUDING ALL);
  CREATE TABLE storefronts(id uuid PRIMARY KEY, seller_id uuid, boost_until timestamptz);
  CREATE UNIQUE INDEX entitlements_key ON entitlements(user_id,area,type);
  CREATE UNIQUE INDEX invoices_payment_key ON invoices(payment_id);`);
await db.exec(
  fs.readFileSync("supabase/migrations/20260313130000_ozow_provider_neutral_payments.sql", "utf8")
);
await db.exec(
  fs.readFileSync("supabase/migrations/20260909090000_atomic_payment_fulfillment.sql", "utf8")
);
await db.exec(`GRANT USAGE ON SCHEMA public TO service_role, anon, authenticated;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
  ALTER TABLE payments ENABLE ROW LEVEL SECURITY;`);

for (const migration of [
  "20260402000000_payments_inflight_unique.sql",
  "20260405100000_payments_provider_payment_id_unique.sql",
])
  await db.exec(fs.readFileSync(`supabase/migrations/${migration}`, "utf8"));

const uuid = () => crypto.randomUUID();
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const userId = uuid();
const otherUser = uuid();
const planId = uuid();
await db.query("INSERT INTO auth.users VALUES ($1),($2)", [userId, otherUser]);
await db.query("INSERT INTO account_profiles VALUES ($1,'active'),($2,'active')", [
  userId,
  otherUser,
]);
await db.query(
  "INSERT INTO plans(id,area,tier,name,price_cents) VALUES ($1,'MZANSI_MARKET','growth','Growth',25000)",
  [planId]
);
const metadata = {
  type: "subscription",
  plan_id: planId,
  plan_tier: "growth",
  area: "MZANSI_MARKET",
};
async function payment(options = {}) {
  const row = {
    id: uuid(),
    created_at: "2026-09-09T10:00:00Z",
    status: "pending",
    user_id: userId,
    amount_cents: 25000,
    provider_data: metadata,
    ...options,
  };
  await db.query(
    `INSERT INTO payments(id,user_id,area,amount_cents,status,provider,provider_data,created_at)
    VALUES($1,$2,'MZANSI_MARKET',$3,$4,'ozow',$5,$6)`,
    [row.id, row.user_id, row.amount_cents, row.status, row.provider_data, row.created_at]
  );
  return row;
}
async function fulfill(row, overrides = {}) {
  const args = {
    providerId: `provider-${row.id}`,
    amount: row.amount_cents,
    metadata: row.provider_data.metadata ?? row.provider_data,
    plan: planId,
    days: null,
    ...overrides,
  };
  return (
    await scalar("SELECT fulfill_ozow_payment($1,$2,$3,$4,$5,$6,$7) AS result", [
      row.id,
      args.providerId,
      args.amount,
      args.metadata,
      args.plan,
      args.days,
      { event: "successful" },
    ])
  ).result;
}
const getPayment = (id) => scalar("SELECT * FROM payments WHERE id=$1", [id]);
const entitlement = () =>
  scalar("SELECT * FROM entitlements WHERE user_id=$1 AND type='subscription'", [userId]);
let checks = 0;
async function test(name, fn) {
  // Preserve benefits between scenarios, but release unfinished fixture checkouts.
  await db.exec("UPDATE payments SET status='failed' WHERE status IN ('pending','processing')");
  await fn();
  checks++;
  console.log(`PASS ${name}`);
}
try {
  await test("only service_role can execute, without security-definer elevation", async () => {
    const row = await scalar(`SELECT has_function_privilege('anon',
      'fulfill_ozow_payment(uuid,text,integer,jsonb,uuid,numeric,jsonb)','execute') AS anon,
      has_function_privilege('authenticated','fulfill_ozow_payment(uuid,text,integer,jsonb,uuid,numeric,jsonb)','execute') AS member,
      has_function_privilege('service_role','fulfill_ozow_payment(uuid,text,integer,jsonb,uuid,numeric,jsonb)','execute') AS service,
      prosecdef FROM pg_proc WHERE proname='fulfill_ozow_payment'`);
    assert.deepEqual(row, { anon: false, member: false, service: true, prosecdef: false });
    const p = await payment();
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(fulfill(p), /permission denied/);
      await db.exec("RESET ROLE");
    }
    await db.exec("SET ROLE service_role");
    assert.equal((await fulfill(p)).outcome, "completed");
    await db.exec("RESET ROLE");
  });

  await test("invoice failure rolls back entitlement and completion, and a retry succeeds", async () => {
    const before = await entitlement();
    const p = await payment({ created_at: "2026-09-10T10:00:00Z" });
    await db.exec(`CREATE FUNCTION reject_invoice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected invoice failure'; END $$;
      CREATE TRIGGER reject_invoice BEFORE INSERT ON invoices FOR EACH ROW EXECUTE FUNCTION reject_invoice();`);
    await assert.rejects(fulfill(p), /injected invoice failure/);
    assert.deepEqual(await entitlement(), before);
    assert.equal((await getPayment(p.id)).status, "pending");
    assert.equal(
      (await scalar("SELECT count(*)::int AS n FROM invoices WHERE payment_id=$1", [p.id])).n,
      0
    );
    await db.exec("DROP TRIGGER reject_invoice ON invoices");
    assert.equal((await fulfill(p)).outcome, "completed");
    const after = await entitlement();
    assert.equal((await fulfill(p)).outcome, "duplicate");
    assert.deepEqual(await entitlement(), after);
    const invoice = await scalar("SELECT * FROM invoices WHERE payment_id=$1", [p.id]);
    assert.equal(invoice.amount_cents + invoice.vat_cents, 25000);
    assert.equal(invoice.total_cents, 25000);
    assert.equal(new Date(after.expires_at) - new Date(p.created_at), 30 * 86400000);
  });

  await test("old payment does not overwrite a newer plan and still gets its invoice", async () => {
    const before = await entitlement();
    const old = await payment({ created_at: "2026-09-01T10:00:00Z" });
    await fulfill(old);
    assert.deepEqual(await entitlement(), before);
    assert.equal(
      (await scalar("SELECT count(*)::int AS n FROM invoices WHERE payment_id=$1", [old.id])).n,
      1
    );
  });

  for (const status of ["active", "cancelled"]) {
    await test(`plan-change upsert reactivates the same ${status} entitlement`, async () => {
      await db.query("UPDATE entitlements SET status=$1,cancelled_at=now() WHERE user_id=$2", [
        status,
        userId,
      ]);
      const before = await entitlement();
      const p = await payment({
        created_at: status === "active" ? "2026-09-11T10:00:00Z" : "2026-09-12T10:00:00Z",
        provider_data: { ...metadata, previous_entitlement_id: before.id, is_plan_change: true },
      });
      await fulfill(p);
      const after = await entitlement();
      assert.equal(after.id, before.id);
      assert.equal(after.status, "active");
      assert.equal(after.cancelled_at, null);
    });
  }
  await test("restricted accounts receive pending-verification benefits", async () => {
    await db.query("UPDATE account_profiles SET account_status='restricted' WHERE user_id=$1", [
      userId,
    ]);
    await fulfill(await payment({ created_at: "2026-09-13T10:00:00Z" }));
    assert.equal((await entitlement()).status, "pending_verification");
    await db.query("UPDATE account_profiles SET account_status='active' WHERE user_id=$1", [
      userId,
    ]);
  });
  await test("invoice-number collisions with a different payment are real errors", async () => {
    const first = await payment();
    await fulfill(first);
    const collision = await payment({ id: first.id.slice(0, 8) + uuid().slice(8) });
    await assert.rejects(fulfill(collision), /duplicate key/);
    assert.equal((await getPayment(collision.id)).status, "pending");
  });
  await test("SAST invoice date is independent of database session timezone", async () => {
    const p = await payment({ created_at: "2026-09-09T23:30:00Z" });
    await fulfill(p);
    assert.match(
      (await scalar("SELECT invoice_number FROM invoices WHERE payment_id=$1", [p.id]))
        .invoice_number,
      /^INV-20260910-/
    );
  });
  await test("identity, amount, metadata and active plan changes fail closed", async () => {
    const p = await payment();
    await assert.rejects(fulfill(p, { amount: 1 }), /amount mismatch/);
    await assert.rejects(fulfill(p, { providerId: "" }), /Missing provider/);
    await assert.rejects(
      fulfill(p, { metadata: { ...metadata, plan_tier: "pro" } }),
      /metadata changed/
    );
    await db.query("UPDATE plans SET active=false WHERE id=$1", [planId]);
    await assert.rejects(fulfill(p), /Paid plan validation/);
    await db.query("UPDATE plans SET active=true WHERE id=$1", [planId]);
    await db.query("UPDATE payments SET provider_payment_id='different' WHERE id=$1", [p.id]);
    await assert.rejects(fulfill(p), /Payment ID mismatch/);
    assert.equal((await getPayment(p.id)).status, "pending");
  });
  for (const status of ["failed", "expired", "refunded"]) {
    await test(`${status} lifecycle does not resurrect refunded payments`, async () => {
      const p = await payment({ status });
      const r = await fulfill(p);
      assert.equal(r.outcome, status === "refunded" ? "ignored" : "completed");
      assert.equal(
        (await getPayment(p.id)).status,
        status === "refunded" ? "refunded" : "complete"
      );
    });
  }
  await test("legacy unmarked processing is never replayed, regardless of age", async () => {
    const p = await payment({ status: "processing", created_at: "2020-01-01T00:00:00Z" });
    await assert.rejects(fulfill(p), /requires reconciliation/);
    assert.equal((await getPayment(p.id)).status, "processing");
  });
  await test("legacy marked processing finalizes without touching benefits", async () => {
    const before = await entitlement();
    const p = await payment({
      status: "processing",
      provider_data: { ...metadata, fulfillment_completed_at: "2026-09-09T10:01:00Z" },
    });
    assert.equal((await fulfill(p, { plan: null })).outcome, "recovered");
    assert.deepEqual(await entitlement(), before);
    assert.equal(
      (await scalar("SELECT count(*)::int AS n FROM invoices WHERE payment_id=$1", [p.id])).n,
      0
    );
  });
  const addons = [
    ["boost", "listings", "listing_id", "boost_until"],
    ["featured", "listings", "listing_id", "featured_until"],
    ["urgent", "listings", "listing_id", "urgent_until"],
    ["boost_business", "businesses", "business_profile_id", "boost_until"],
    ["featured_business", "businesses", "business_id", "featured_until"],
    ["urgent_business", "businesses", "business_id", "urgent_until"],
    ["boost_promotion", "promotions", "promotion_id", "boost_until"],
    ["featured_promotion", "promotions", "promotion_id", "featured_until"],
    ["urgent_promotion", "promotions", "promotion_id", "urgent_until"],
    ["boost_storefront", "storefronts", "storefront_id", "boost_until"],
  ];
  for (const [type, table, key, column] of addons) {
    await test(`${type}: owner enforcement, nested metadata, idempotency and duration ordering`, async () => {
      const id = uuid();
      const owner = table === "storefronts" ? "seller_id" : "owner_id";
      await db.query(`INSERT INTO ${table}(id,${owner}) VALUES($1,$2)`, [id, otherUser]);
      const p = await payment({ provider_data: { metadata: { type, [key]: id } } });
      await assert.rejects(fulfill(p, { plan: null, days: 7 }), /not found or not owned/);
      assert.equal((await getPayment(p.id)).status, "pending");
      await db.query(`UPDATE ${table} SET ${owner}=$1 WHERE id=$2`, [userId, id]);
      await fulfill(p, { plan: null, days: 7 });
      assert.equal((await fulfill(p, { plan: null, days: 7 })).outcome, "duplicate");
      const until = (await scalar(`SELECT ${column} AS until FROM ${table} WHERE id=$1`, [id]))
        .until;
      assert.equal(new Date(until) - new Date(p.created_at), 7 * 86400000);
      const old = await payment({
        created_at: "2026-09-01T10:00:00Z",
        provider_data: p.provider_data,
      });
      await fulfill(old, { plan: null, days: 7 });
      assert.equal(
        String((await scalar(`SELECT ${column} AS until FROM ${table} WHERE id=$1`, [id])).until),
        String(until)
      );
      assert.equal(
        (
          await scalar(
            "SELECT count(*)::int AS n FROM audit_logs WHERE metadata->>'paymentId'=$1",
            [p.id]
          )
        ).n,
        1
      );
    });
  }
  await test("an audit failure rolls back an addon and payment completion", async () => {
    const id = uuid();
    await db.query("INSERT INTO listings(id,owner_id) VALUES($1,$2)", [id, userId]);
    const p = await payment({ provider_data: { type: "boost", listing_id: id } });
    await db.exec(`CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$;
      CREATE TRIGGER reject_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit();`);
    await assert.rejects(fulfill(p, { plan: null, days: 7 }), /injected audit failure/);
    assert.equal(
      (await scalar("SELECT boost_until FROM listings WHERE id=$1", [id])).boost_until,
      null
    );
    assert.equal((await getPayment(p.id)).status, "pending");
    await db.exec("DROP TRIGGER reject_audit ON audit_logs");
  });
  await test("a late failure CAS cannot downgrade a committed payment", async () => {
    const p = await payment();
    await fulfill(p);
    const result = await db.query(
      "UPDATE payments SET status='failed' WHERE id=$1 AND status='pending' RETURNING id",
      [p.id]
    );
    assert.equal(result.rows.length, 0);
    assert.equal((await getPayment(p.id)).status, "complete");
  });
  await test("the production in-flight index rejects concurrent checkout inserts", async () => {
    await payment();
    await assert.rejects(payment(), /idx_payments_inflight_unique/);
  });
  await test("a provider ID collision rolls back all effects for the second payment", async () => {
    const first = await payment();
    await fulfill(first);
    const before = await entitlement();
    const second = await payment({ created_at: "2026-09-20T10:00:00Z" });
    await assert.rejects(
      fulfill(second, { providerId: `provider-${first.id}` }),
      /idx_payments_provider_payment_id_unique/
    );
    assert.equal((await getPayment(second.id)).status, "pending");
    assert.deepEqual(await entitlement(), before);
    assert.equal(
      (await scalar("SELECT count(*)::int AS n FROM invoices WHERE payment_id=$1", [second.id])).n,
      0
    );
  });
  await test("subscription and addon durations stay fixed across DST session timezones", async () => {
    await db.exec("SET TIME ZONE 'America/New_York'");
    try {
      const p = await payment({ created_at: "2026-03-01T12:00:00Z" });
      const result = await fulfill(p);
      assert.equal(Date.parse(result.expires_at) - Date.parse(p.created_at), 720 * 3600000);
      const id = uuid();
      await db.query("INSERT INTO listings(id,owner_id) VALUES($1,$2)", [id, userId]);
      const addon = await payment({
        created_at: "2026-03-01T12:00:00Z",
        provider_data: { type: "boost", listing_id: id },
      });
      const boosted = await fulfill(addon, { plan: null, days: 14 });
      assert.equal(
        Date.parse(boosted.expires_at) - Date.parse(addon.created_at),
        14 * 24 * 3600000
      );
    } finally {
      await db.exec("SET TIME ZONE 'UTC'");
    }
  });
  console.log(
    `${checks} isolated payment database checks passed (PGlite; not multi-session or deployed PostgREST verification).`
  );
} finally {
  await db.close();
}
