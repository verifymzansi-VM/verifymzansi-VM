// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");
const OWNER = "00000000-0000-0000-0000-00000000000a";
const HELD = "00000000-0000-0000-0000-00000000000b";

const db = new PGlite();

/** Only the delete-guard and file-cleanup parts of the migration (no FK changes). */
function guardsOnly(sql: string): string {
  const start = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.queue_business_verification_file_cleanup"
  );
  return sql.slice(start);
}

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
    CREATE FUNCTION public.has_role(r text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE TABLE public.account_profiles (user_id uuid PRIMARY KEY, legal_hold boolean NOT NULL DEFAULT false);
    INSERT INTO public.account_profiles VALUES ('${OWNER}', false), ('${HELD}', true);
    CREATE TABLE public.listings (id serial PRIMARY KEY, owner_id uuid, status text);
    CREATE TABLE public.businesses (id serial PRIMARY KEY, owner_id uuid, status text);
    CREATE TABLE public.promotions (id serial PRIMARY KEY, owner_id uuid, status text);
    CREATE TABLE public.r2_cleanup_queue (bucket text, r2_key text, reason text, processed_at timestamptz);
    CREATE TABLE public.business_verification_files (id serial PRIMARY KEY, r2_key text, purged_at timestamptz);
  `);
  await db.exec(guardsOnly(read("20261007042641_account_deletion_and_delete_guards.sql")));
});

afterAll(async () => {
  await db.close();
});

async function as(role: string) {
  await db.exec(`SELECT set_config('test.role', '${role}', false)`);
}

describe("content delete guards", () => {
  it("lets owners delete ordinary posts", async () => {
    await as("authenticated");
    await db.exec(`INSERT INTO public.listings (owner_id, status) VALUES ('${OWNER}', 'live')`);
    await expect(
      db.exec(`DELETE FROM public.listings WHERE status = 'live'`)
    ).resolves.toBeDefined();
  });

  it("keeps suspended and flagged posts as evidence", async () => {
    await as("authenticated");
    await db.exec(
      `INSERT INTO public.businesses (owner_id, status) VALUES ('${OWNER}', 'suspended')`
    );
    await expect(db.exec(`DELETE FROM public.businesses`)).rejects.toThrow(/content_under_review/);
  });

  it("refuses any delete while the owner is on legal hold, even for the service role", async () => {
    await as("service_role");
    await db.exec(`INSERT INTO public.promotions (owner_id, status) VALUES ('${HELD}', 'draft')`);
    await expect(db.exec(`DELETE FROM public.promotions`)).rejects.toThrow(
      /content_under_legal_hold/
    );
  });

  it("queues verification documents for storage deletion when their rows go", async () => {
    await as("service_role");
    await db.exec(`
      INSERT INTO public.business_verification_files (r2_key) VALUES ('kyc/business-cipc/a.bin'), ('kyc/business-cipc/b.bin');
      UPDATE public.business_verification_files SET purged_at = now() WHERE r2_key LIKE '%b.bin';
      DELETE FROM public.business_verification_files;
    `);
    const res = await db.query<{ r2_key: string; bucket: string }>(
      `SELECT r2_key, bucket FROM public.r2_cleanup_queue`
    );
    expect(res.rows).toEqual([{ r2_key: "kyc/business-cipc/a.bin", bucket: "private" }]);
  });
});
