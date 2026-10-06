// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  "supabase/migrations/20261006093031_promotion_business_owner_guard.sql",
  "utf8"
);

const OWNER = "00000000-0000-0000-0000-00000000000a";
const OTHER = "00000000-0000-0000-0000-00000000000b";
const OWN_BIZ = "00000000-0000-0000-0000-0000000000b1";
const OTHER_BIZ = "00000000-0000-0000-0000-0000000000b2";

const db = new PGlite();

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
    CREATE FUNCTION public.has_role(p text) RETURNS boolean LANGUAGE sql STABLE
      AS $$ SELECT current_setting('test.staff', true) = p $$;
    CREATE TABLE public.businesses (id uuid PRIMARY KEY, owner_id uuid);
    CREATE TABLE public.promotions (id serial PRIMARY KEY, owner_id uuid, business_id uuid);
    INSERT INTO public.businesses VALUES ('${OWN_BIZ}', '${OWNER}'), ('${OTHER_BIZ}', '${OTHER}');
  `);
  await db.exec(MIGRATION);
});

afterAll(async () => {
  await db.close();
});

async function asRole(role: string) {
  await db.exec(`SELECT set_config('test.role', '${role}', false)`);
}

describe("guard_promotion_business_owner", () => {
  it("lets a member link their own business", async () => {
    await asRole("authenticated");
    await expect(
      db.exec(
        `INSERT INTO public.promotions (owner_id, business_id) VALUES ('${OWNER}', '${OWN_BIZ}')`
      )
    ).resolves.toBeDefined();
  });

  it("blocks a member from linking someone else's business on insert", async () => {
    await asRole("authenticated");
    await expect(
      db.exec(
        `INSERT INTO public.promotions (owner_id, business_id) VALUES ('${OWNER}', '${OTHER_BIZ}')`
      )
    ).rejects.toThrow(/only link a business you own/);
  });

  it("blocks re-pointing an existing promotion at someone else's business", async () => {
    await asRole("authenticated");
    await expect(
      db.exec(
        `UPDATE public.promotions SET business_id = '${OTHER_BIZ}' WHERE owner_id = '${OWNER}'`
      )
    ).rejects.toThrow(/only link a business you own/);
  });

  it("allows promotions without a business", async () => {
    await asRole("authenticated");
    await expect(
      db.exec(`INSERT INTO public.promotions (owner_id, business_id) VALUES ('${OWNER}', NULL)`)
    ).resolves.toBeDefined();
  });

  it("leaves service-role routes to their own ownership checks", async () => {
    await asRole("service_role");
    await expect(
      db.exec(
        `INSERT INTO public.promotions (owner_id, business_id) VALUES ('${OWNER}', '${OTHER_BIZ}')`
      )
    ).resolves.toBeDefined();
  });
});
