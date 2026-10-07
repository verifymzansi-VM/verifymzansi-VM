// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SQL = readFileSync(
  "supabase/migrations/20261007121453_private_post_tables.sql",
  "utf8"
).split("-- Organisation admins")[0];
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
