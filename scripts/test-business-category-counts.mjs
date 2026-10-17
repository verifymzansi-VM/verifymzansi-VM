// In-memory PostgreSQL proof using the actual migration and placeholder helper.
// No hosted database, account or customer records are accessed.
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (name) => fs.readFileSync(`supabase/migrations/${name}`, "utf8");
const placeholder = read("20261002135904_fair_showroom_rotation.sql").match(
  /CREATE OR REPLACE FUNCTION public\.is_placeholder_content\([\s\S]*?\$\$;/
)?.[0];
assert(placeholder, "actual placeholder helper is present");
const migration = read("20261013120246_business_category_counts.sql");
const db = new PGlite();
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TYPE marketplace_area AS ENUM ('MZANSI_BUSINESS','PROMOTIONS_EVENTS','MZANSI_MARKET');
    CREATE TYPE listing_status AS ENUM ('live','draft','pending_moderation','suspended','archived');
    CREATE TYPE business_category AS ENUM ('food_dining','automotive_transport','tourism_hospitality','general_other');
    -- owner_id is text only to exercise the Playwright pw-* fixture convention;
    -- the hosted UUID column is cast to text by the same production function.
    CREATE TABLE public.businesses (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, owner_id text NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
      category business_category NOT NULL DEFAULT 'food_dining', status listing_status NOT NULL DEFAULT 'live',
      area marketplace_area NOT NULL DEFAULT 'MZANSI_BUSINESS', business_name text NOT NULL DEFAULT 'Local shop',
      description text, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT SELECT ON public.businesses TO service_role;
    ${placeholder}
    ${migration}
    BEGIN;
    INSERT INTO businesses (expires_at) SELECT now() + interval '1 day' FROM generate_series(1,12001);
    INSERT INTO businesses (category,area,expires_at) VALUES ('tourism_hospitality','PROMOTIONS_EVENTS', now() + interval '1 day');
    INSERT INTO businesses (category,created_at) VALUES ('automotive_transport', now() - interval '6 days');
    INSERT INTO businesses (category,business_name,description,expires_at,created_at) VALUES
      ('general_other','Seed potatoes','Free samples and book a demo', now() + interval '1 day', now() - interval '1 year');
    INSERT INTO businesses (owner_id,expires_at) VALUES ('pw-fixture-owner',now() + interval '1 day');
    -- Each excluded row has its own category so leaks are immediately visible.
    INSERT INTO businesses (category,status,expires_at) VALUES
      ('general_other','draft',now() + interval '1 day'),
      ('general_other','pending_moderation',now() + interval '1 day'),
      ('general_other','suspended',now() + interval '1 day'),
      ('general_other','archived',now() + interval '1 day');
    INSERT INTO businesses (category,area,expires_at) VALUES ('general_other','MZANSI_MARKET',now() + interval '1 day');
    INSERT INTO businesses (category,expires_at,created_at) VALUES
      ('general_other',now(),now()), ('general_other',now() - interval '1 second',now()),
      ('general_other',NULL,now() - interval '7 days'), ('general_other',NULL,now() - interval '8 days');
    INSERT INTO businesses (category,business_name,description,expires_at) VALUES
      ('general_other','[demo] Shop',NULL,now() + interval '1 day'),
      ('general_other','Shop','A SANDBOX business',now() + interval '1 day'),
      ('general_other','Placeholder shop',NULL,now() + interval '1 day');
  `);

  const signature = "public.get_business_category_counts(boolean)";
  for (const role of ["anon", "authenticated"]) {
    assert.equal(
      (
        await db.query(`SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed`, [
          role,
          signature,
        ])
      ).rows[0].allowed,
      false
    );
    await db.exec(`SAVEPOINT denied_call; SET LOCAL ROLE ${role}`);
    await assert.rejects(
      db.query(`SELECT * FROM public.get_business_category_counts()`),
      /permission denied/
    );
    await db.exec("ROLLBACK TO SAVEPOINT denied_call; RELEASE SAVEPOINT denied_call");
  }
  await db.exec("SET LOCAL ROLE service_role");
  const counts = async (hide = false) =>
    Object.fromEntries(
      (await db.query(`SELECT * FROM public.get_business_category_counts($1)`, [hide])).rows.map(
        (row) => [row.category, Number(row.count)]
      )
    );
  assert.deepEqual(await counts(), {
    food_dining: 12002,
    automotive_transport: 1,
    tourism_hospitality: 1,
    general_other: 1,
  });
  assert.deepEqual(await counts(true), {
    food_dining: 12001,
    automotive_transport: 1,
    tourism_hospitality: 1,
    general_other: 1,
  });
  await db.exec("RESET ROLE; COMMIT");
  const [{ prosecdef, proconfig }] = (
    await db.query(`SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure`, [
      signature,
    ])
  ).rows;
  assert.equal(prosecdef, false, "RPC never escalates caller privileges");
  assert.deepEqual(proconfig, ["search_path=pg_catalog"]);
  await db.exec("TRUNCATE public.businesses; SET ROLE service_role");
  assert.deepEqual(await counts(), {});
  console.log(
    "Business category counts PostgreSQL checks passed (12,001+ visible records, exclusions, strict expiry, fixture flag, service-only execution)."
  );
} finally {
  await db.close();
}
