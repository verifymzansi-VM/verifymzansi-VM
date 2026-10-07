// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const db = new PGlite();

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE public.businesses (
      id serial PRIMARY KEY, business_name text, status text,
      phone text, whatsapp text, email text, location_address text, map_directions text
    );
    CREATE TABLE public.listings (id serial PRIMARY KEY, title text, location_address text);
    CREATE TABLE public.promotions (id serial PRIMARY KEY, title text);
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses, public.listings, public.promotions
      TO anon, authenticated;
    INSERT INTO public.businesses (business_name, status, phone) VALUES ('Corner tailor', 'live', '+27821111111');
    INSERT INTO public.listings (title, location_address) VALUES ('Bike', '3 Home St');
  `);
  await db.exec(read("20261007120240_private_post_columns.sql"));
});

afterAll(async () => {
  await db.close();
});

async function asRole(role: string, sql: string) {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("RESET ROLE");
  }
}

describe("private post columns migration", () => {
  it("hides contact and address columns while keeping public ones", async () => {
    await expect(asRole("anon", "SELECT phone FROM public.businesses")).rejects.toThrow(
      /permission denied/
    );
    await expect(
      asRole("authenticated", "SELECT location_address FROM public.listings")
    ).rejects.toThrow(/permission denied/);
    const res = await asRole("anon", "SELECT id, business_name FROM public.businesses");
    expect(res.rows).toHaveLength(1);
  });

  it("can re-grant after a column is added", async () => {
    await db.exec(`
      ALTER TABLE public.businesses ADD COLUMN tagline text;
      SELECT public.grant_public_post_columns();
    `);
    await expect(asRole("anon", "SELECT tagline FROM public.businesses")).resolves.toBeDefined();
  });

  describe("after the read rollback", () => {
    beforeAll(async () => {
      await db.exec(read("20261007120524_restore_post_table_select.sql"));
    });

    it("lets whole-row reads work again (showroom rotation needs them)", async () => {
      const res = await asRole("anon", "SELECT b FROM public.businesses b");
      expect(res.rows).toHaveLength(1);
    });

    it("still sends deletes through the app", async () => {
      for (const table of ["listings", "businesses", "promotions"]) {
        await expect(asRole("authenticated", `DELETE FROM public.${table}`)).rejects.toThrow(
          /permission denied/
        );
      }
      await expect(asRole("anon", "UPDATE public.promotions SET title = 'x'")).rejects.toThrow(
        /permission denied/
      );
    });
  });
});
