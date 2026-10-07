// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SQL = readFileSync(
  "supabase/migrations/20261007121453_private_post_tables.sql",
  "utf8"
).split("-- Organisation admins")[0];
const STEP2 = readFileSync(
  "supabase/migrations/20261007164554_private_post_fields_move.sql",
  "utf8"
).replace("DROP FUNCTION IF EXISTS public.grant_public_post_columns();", "");
const db = new PGlite();
const B = "00000000-0000-0000-0000-0000000000b1";

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_name text,
      phone text, whatsapp text, email text, location_address text, map_directions text);
    CREATE TABLE public.listings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, location_address text);
    INSERT INTO public.businesses (id, business_name, phone, email) VALUES ('${B}', 'Old shop', '+27820000001', 'a@b.co');
    GRANT SELECT, INSERT, UPDATE ON public.businesses, public.listings TO authenticated;
  `);
  await db.exec(SQL);
});
afterAll(async () => db.close());

const priv = async (id: string) =>
  (
    await db.query(
      `SELECT phone, whatsapp, email, location_address FROM public.business_private WHERE business_id = '${id}'`
    )
  ).rows[0];

describe("private post tables, step 1", () => {
  it("copies existing values", async () => {
    expect(await priv(B)).toMatchObject({ phone: "+27820000001", email: "a@b.co", whatsapp: null });
  });

  it("copies on insert, including from a member's own session", async () => {
    await db.exec(`SET ROLE authenticated`);
    const res = await db.query<{ id: string }>(
      `INSERT INTO public.businesses (business_name, whatsapp) VALUES ('New', '+27820000002') RETURNING id`
    );
    await db.exec(
      `INSERT INTO public.listings (title, location_address) VALUES ('Bike', '3 Home St')`
    );
    await db.exec(`RESET ROLE`);
    expect(await priv(res.rows[0].id)).toMatchObject({ whatsapp: "+27820000002", phone: null });
    const l = await db.query(`SELECT location_address FROM public.listing_private`);
    expect(l.rows).toEqual([{ location_address: "3 Home St" }]);
  });

  it("updates only the fields in the SET list", async () => {
    await db.exec(`UPDATE public.businesses SET phone = '+27820000009' WHERE id = '${B}'`);
    expect(await priv(B)).toMatchObject({ phone: "+27820000009", email: "a@b.co" });
    await db.exec(
      `UPDATE public.businesses SET email = NULL, business_name = 'x' WHERE id = '${B}'`
    );
    expect(await priv(B)).toMatchObject({ phone: "+27820000009", email: null });
    await db.exec(`UPDATE public.businesses SET business_name = 'y' WHERE id = '${B}'`);
    expect(await priv(B)).toMatchObject({ phone: "+27820000009" });
  });

  it("keeps the private table away from app roles and deletes with the post", async () => {
    await db.exec(`SET ROLE anon`);
    await expect(db.query(`SELECT * FROM public.business_private`)).rejects.toThrow(
      /permission denied/
    );
    await db.exec(`RESET ROLE`);
    await db.exec(`DELETE FROM public.businesses WHERE id = '${B}'`);
    expect(await priv(B)).toBeUndefined();
  });
});

describe("private post fields, step 2", () => {
  const L = "00000000-0000-0000-0000-0000000000c1";
  beforeAll(async () => {
    await db.exec(
      `INSERT INTO public.businesses (business_name, phone, location_address) VALUES ('Keep', '+27820000003', '5 Side Rd')`
    );
    await db.exec(
      `INSERT INTO public.listings (id, title, location_address) VALUES ('${L}', 'Car', '7 Lane')`
    );
    await db.exec(STEP2);
  });

  it("clears existing public copies, keeping the private values", async () => {
    const pub = await db.query(
      `SELECT phone, location_address FROM public.businesses WHERE business_name = 'Keep'`
    );
    expect(pub.rows).toEqual([{ phone: null, location_address: null }]);
    const p = await db.query(
      `SELECT bp.phone, bp.location_address FROM public.business_private bp JOIN public.businesses b ON b.id = bp.business_id WHERE b.business_name = 'Keep'`
    );
    expect(p.rows).toEqual([{ phone: "+27820000003", location_address: "5 Side Rd" }]);
  });

  it("moves new writes into the private table", async () => {
    await db.exec(`SET ROLE authenticated`);
    const res = await db.query<{ id: string; phone: string | null }>(
      `INSERT INTO public.businesses (business_name, phone) VALUES ('Fresh', '+27820000004') RETURNING id, phone`
    );
    await db.exec(`UPDATE public.listings SET location_address = '8 Lane' WHERE id = '${L}'`);
    await db.exec(`RESET ROLE`);
    expect(res.rows[0].phone).toBeNull();
    expect(await priv(res.rows[0].id)).toMatchObject({ phone: "+27820000004" });
    const l = await db.query(
      `SELECT l.location_address pub, p.location_address priv FROM public.listings l JOIN public.listing_private p ON p.listing_id = l.id WHERE l.id = '${L}'`
    );
    expect(l.rows).toEqual([{ pub: null, priv: "8 Lane" }]);
  });
});
