// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  "supabase/migrations/20261006185253_business_verification_privacy.sql",
  "utf8"
);
const BIZ = "00000000-0000-0000-0000-0000000000b1";
const OFFICE = JSON.stringify({
  streetLines: ["12 Main Road"],
  suburb: "KwaDlangezwa",
  city: "Empangeni",
  province: "KwaZulu-Natal",
  postalCode: "3886",
  cityKnown: true,
});

const db = new PGlite();

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE public.businesses (
      id uuid PRIMARY KEY,
      cipc_registered_office jsonb,
      show_full_registered_office boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.business_verification_files (id serial PRIMARY KEY, extracted_text text);
    INSERT INTO public.businesses VALUES ('${BIZ}', '${OFFICE}'::jsonb, false);
    INSERT INTO public.business_verification_files (extracted_text)
      VALUES ('DLAMINI, THANDO 800101 5009 087 Director'), ('No IDs here 2020/123456/07');
  `);
  await db.exec(MIGRATION);
});

afterAll(async () => {
  await db.close();
});

async function office() {
  const res = await db.query<{ o: Record<string, unknown> }>(
    `SELECT cipc_registered_office AS o FROM public.businesses WHERE id = '${BIZ}'`
  );
  return res.rows[0].o;
}

describe("business verification privacy migration", () => {
  it("strips street lines from existing hidden offices", async () => {
    expect(await office()).toEqual({
      suburb: "KwaDlangezwa",
      city: "Empangeni",
      province: "KwaZulu-Natal",
    });
  });

  it("never stores hidden street lines, whatever the app writes", async () => {
    await db.exec(
      `UPDATE public.businesses SET cipc_registered_office = '${OFFICE}'::jsonb WHERE id = '${BIZ}'`
    );
    expect(await office()).not.toHaveProperty("streetLines");
    expect(await office()).not.toHaveProperty("postalCode");
  });

  it("keeps the street when the owner chooses to show it", async () => {
    await db.exec(`
      UPDATE public.businesses
         SET show_full_registered_office = true, cipc_registered_office = '${OFFICE}'::jsonb
       WHERE id = '${BIZ}'`);
    expect(await office()).toMatchObject({ streetLines: ["12 Main Road"], postalCode: "3886" });
    expect(await office()).not.toHaveProperty("cityKnown");
  });

  it("strips the street again when the owner hides it", async () => {
    await db.exec(
      `UPDATE public.businesses SET show_full_registered_office = false WHERE id = '${BIZ}'`
    );
    expect(await office()).not.toHaveProperty("streetLines");
  });

  it("masks ID numbers already stored in extracted text", async () => {
    const res = await db.query<{ t: string }>(
      `SELECT extracted_text AS t FROM public.business_verification_files ORDER BY id`
    );
    expect(res.rows.map((r) => r.t)).toEqual([
      "DLAMINI, THANDO [ID number] Director",
      "No IDs here 2020/123456/07",
    ]);
  });
});
