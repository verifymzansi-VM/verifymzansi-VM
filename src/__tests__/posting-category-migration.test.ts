// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENUMS = readFileSync(
  "supabase/migrations/20260928100000_posting_category_values.sql",
  "utf8"
);
const MAPPING = readFileSync(
  "supabase/migrations/20260928100100_posting_category_mapping.sql",
  "utf8"
);

const db = new PGlite();

beforeAll(async () => {
  // Legacy enum values as they exist before this release.
  await db.exec(`
    CREATE TYPE public.business_category AS ENUM (
      'fashion_accessories', 'electronics_tech', 'food_dining', 'health_beauty', 'home_living',
      'automotive_transport', 'professional_services', 'education_training', 'events_entertainment',
      'trade_maintenance', 'groceries_essentials', 'tourism_hospitality', 'general_other'
    );
    CREATE TYPE public.listing_category AS ENUM (
      'property', 'vehicles', 'auto_parts', 'electronics', 'home_lifestyle', 'jobs_services',
      'farming_agriculture', 'baby_kids'
    );
    CREATE TABLE public.businesses (
      id text PRIMARY KEY, owner_id text, status text, slug text,
      category public.business_category, subcategory text, category_details jsonb
    );
    CREATE TABLE public.listings (
      id text PRIMARY KEY, owner_id text, status text,
      category public.listing_category, attributes jsonb
    );
    INSERT INTO public.businesses VALUES
      ('dentist', 'o1', 'live', 'smile', 'health_beauty', 'dentist', '{"business_profile":{"year_established":2001}}'),
      ('salon', 'o2', 'pending', 'hair', 'health_beauty', 'hair_salon_barber', NULL),
      ('ambiguous', 'o3', 'live', 'amb', 'health_beauty', NULL, NULL),
      ('mechanic', 'o4', 'live', 'mech', 'automotive_transport', 'mechanic_workshop', NULL),
      ('courier', 'o5', 'live', 'cour', 'automotive_transport', 'courier_logistics', NULL),
      ('driving', 'o6', 'live', 'drive', 'automotive_transport', 'driving_school_auto', NULL),
      ('bakery', 'o7', 'live', 'bake', 'groceries_essentials', 'bakery_retail', NULL),
      ('plumber', 'o8', 'live', 'plumb', 'trade_maintenance', 'plumber', NULL);
    INSERT INTO public.listings VALUES
      ('shirt', 'o1', 'live', 'home_lifestyle', '{"sub_category":"clothing","brand":"Levi"}'),
      ('guitar', 'o2', 'live', 'home_lifestyle', '{"sub_category":"musical_instruments"}'),
      ('pram', 'o3', 'live', 'home_lifestyle', '{"sub_category":"baby_kids"}'),
      ('sofa', 'o4', 'live', 'home_lifestyle', '{"sub_category":"furniture"}');
  `);
}, 30_000);

afterAll(async () => {
  await db.close();
});

async function business(id: string) {
  const { rows } = await db.query<{
    category: string;
    subcategory: string | null;
    category_details: Record<string, unknown> | null;
    owner_id: string;
    status: string;
    slug: string;
  }>(
    "SELECT category::text, subcategory, category_details, owner_id, status, slug FROM public.businesses WHERE id = $1",
    [id]
  );
  return rows[0];
}

async function listing(id: string) {
  const { rows } = await db.query<{ category: string; attributes: Record<string, unknown> }>(
    "SELECT category::text, attributes FROM public.listings WHERE id = $1",
    [id]
  );
  return rows[0];
}

describe("posting category migrations", () => {
  it("adds enum values, then maps only known activities", async () => {
    await db.exec(ENUMS);
    await db.exec(MAPPING);

    const dentist = await business("dentist");
    expect(dentist.category).toBe("health_medical");
    expect(dentist.category_details).toMatchObject({
      previous_category: "health_beauty",
      business_profile: { year_established: 2001 },
    });
    expect(dentist).toMatchObject({ owner_id: "o1", status: "live", slug: "smile" });

    expect((await business("salon")).category).toBe("beauty_personal");
    expect((await business("salon")).status).toBe("pending");
    expect((await business("mechanic")).category).toBe("automotive_services");
    expect((await business("mechanic")).category_details).toMatchObject({
      previous_category: "automotive_transport",
    });
    expect((await business("courier")).category).toBe("transport_storage");

    const driving = await business("driving");
    expect(driving).toMatchObject({
      category: "education_training",
      subcategory: "driving_school",
    });
    const bakery = await business("bakery");
    expect(bakery).toMatchObject({ category: "food_dining", subcategory: "bakery_patisserie" });
  });

  it("leaves ambiguous and unaffected profiles unchanged", async () => {
    expect(await business("ambiguous")).toMatchObject({
      category: "health_beauty",
      category_details: null,
    });
    expect(await business("plumber")).toMatchObject({
      category: "trade_maintenance",
      category_details: null,
    });
  });

  it("moves only explicit former Home item types and keeps their attributes", async () => {
    expect(await listing("shirt")).toMatchObject({
      category: "clothing_accessories",
      attributes: { brand: "Levi", previous_category: "home_lifestyle" },
    });
    expect((await listing("guitar")).category).toBe("sports_hobbies");
    expect((await listing("pram")).category).toBe("home_lifestyle");
    expect((await listing("sofa")).category).toBe("home_lifestyle");
  });

  it("is safe to run again", async () => {
    const before = await db.query("SELECT * FROM public.businesses ORDER BY id");
    const listingsBefore = await db.query("SELECT * FROM public.listings ORDER BY id");
    await db.exec(ENUMS);
    await db.exec(MAPPING);
    expect((await db.query("SELECT * FROM public.businesses ORDER BY id")).rows).toEqual(
      before.rows
    );
    expect((await db.query("SELECT * FROM public.listings ORDER BY id")).rows).toEqual(
      listingsBefore.rows
    );
  });
});
