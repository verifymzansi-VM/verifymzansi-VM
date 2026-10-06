// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  "supabase/migrations/20261006124457_business_verifications.sql",
  "utf8"
);

const OWNER = "00000000-0000-0000-0000-00000000000a";
const BUYER = "00000000-0000-0000-0000-00000000000b";
const BIZ = "00000000-0000-0000-0000-0000000000b1";

const db = new PGlite();

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE FUNCTION public.has_any_role(r text[]) RETURNS boolean LANGUAGE sql STABLE
      AS $$ SELECT false $$;
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    CREATE TABLE public.businesses (id uuid PRIMARY KEY, owner_id uuid, business_name text);
    INSERT INTO auth.users VALUES ('${OWNER}'), ('${BUYER}');
    INSERT INTO public.businesses VALUES ('${BIZ}', '${OWNER}', 'Example Trading');
  `);
  await db.exec(MIGRATION);
});

afterAll(async () => {
  await db.close();
});

async function as(role: string) {
  await db.exec(`SELECT set_config('test.role', '${role}', false)`);
}

describe("business verification columns", () => {
  it("blocks members from granting themselves a sticker", async () => {
    await as("authenticated");
    await expect(
      db.exec(`UPDATE public.businesses SET cipc_verified_at = now() WHERE id = '${BIZ}'`)
    ).rejects.toThrow(/set by VerifyMzansi staff/);
    await expect(
      db.exec(`UPDATE public.businesses SET owner_position_title = 'CEO' WHERE id = '${BIZ}'`)
    ).rejects.toThrow(/set by VerifyMzansi staff/);
  });

  it("blocks members from inserting a pre-verified business", async () => {
    await as("authenticated");
    await expect(
      db.exec(
        `INSERT INTO public.businesses (id, owner_id, seen_verified_at) VALUES (gen_random_uuid(), '${OWNER}', now())`
      )
    ).rejects.toThrow(/set by VerifyMzansi staff/);
  });

  it("still lets members edit their other fields", async () => {
    await as("authenticated");
    await expect(
      db.exec(`UPDATE public.businesses SET business_name = 'Example Kitchen' WHERE id = '${BIZ}'`)
    ).resolves.toBeDefined();
  });

  it("lets service-role routes write stickers", async () => {
    await as("service_role");
    await db.exec(`
      UPDATE public.businesses SET cipc_verified_at = now(), cipc_registration_number = '2020/123456/07',
        owner_verified_role = 'director' WHERE id = '${BIZ}';
      INSERT INTO public.business_verifications (business_id, owner_id, kind, status, registration_number)
        VALUES ('${BIZ}', '${OWNER}', 'cipc', 'approved', '2020/123456/07');
    `);
    const res = await db.query<{ cipc_registration_number: string }>(
      `SELECT cipc_registration_number FROM public.businesses WHERE id = '${BIZ}'`
    );
    expect(res.rows[0].cipc_registration_number).toBe("2020/123456/07");
  });

  it("clears stickers and revokes cases when ownership changes", async () => {
    await as("service_role");
    await db.exec(`UPDATE public.businesses SET owner_id = '${BUYER}' WHERE id = '${BIZ}'`);
    const biz = await db.query<{
      cipc_verified_at: string | null;
      owner_verified_role: string | null;
    }>(`SELECT cipc_verified_at, owner_verified_role FROM public.businesses WHERE id = '${BIZ}'`);
    expect(biz.rows[0]).toEqual({ cipc_verified_at: null, owner_verified_role: null });
    const cases = await db.query<{ status: string }>(
      `SELECT status FROM public.business_verifications WHERE business_id = '${BIZ}'`
    );
    expect(cases.rows.map((r) => r.status)).toEqual(["revoked"]);
  });

  it("allows only one open case per business and sticker", async () => {
    await as("service_role");
    await db.exec(`INSERT INTO public.business_verifications (business_id, owner_id, kind, registration_number)
      VALUES ('${BIZ}', '${BUYER}', 'cipc', '2020/123456/07')`);
    await expect(
      db.exec(`INSERT INTO public.business_verifications (business_id, owner_id, kind, registration_number)
        VALUES ('${BIZ}', '${BUYER}', 'cipc_link', '2020/123456/07')`)
    ).rejects.toThrow(/business_verifications_one_open/);
    await expect(
      db.exec(`INSERT INTO public.business_verifications (business_id, owner_id, kind)
        VALUES ('${BIZ}', '${BUYER}', 'seen')`)
    ).resolves.toBeDefined();
  });

  it("rejects malformed registration numbers", async () => {
    await as("service_role");
    await expect(
      db.exec(`INSERT INTO public.business_verifications (business_id, owner_id, kind, registration_number)
        VALUES ('${BIZ}', '${BUYER}', 'cipc', '2020-123456-07')`)
    ).rejects.toThrow(/check constraint/);
  });
});
