// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  "supabase/migrations/20261006184423_insert_rpcs_respect_defaults.sql",
  "utf8"
);
const OWNER = "00000000-0000-0000-0000-00000000000a";

const db = new PGlite();

beforeAll(async () => {
  // Minimal tables shaped like production: NOT NULL columns with defaults that
  // the posting payloads never send.
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE FUNCTION public.posting_area_used(u uuid, a text) RETURNS integer
      LANGUAGE sql AS $$ SELECT 0 $$;
    CREATE TABLE public.businesses (
      id uuid PRIMARY KEY, owner_id uuid, business_name text, area text, category text,
      status text, created_at timestamptz, updated_at timestamptz, view_count integer,
      approved_edit_count integer,
      category_details jsonb NOT NULL DEFAULT '{}'::jsonb,
      edited_since_review boolean NOT NULL DEFAULT false,
      engaged_view_count integer NOT NULL DEFAULT 0,
      show_full_registered_office boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.listings (
      id uuid PRIMARY KEY, owner_id uuid, title text, area text, videos text[],
      price_negotiable boolean, buyer_verification_required boolean, attributes jsonb,
      status text, featured boolean, urgent boolean, created_at timestamptz,
      updated_at timestamptz, view_count integer, approved_edit_count integer,
      edited_since_review boolean NOT NULL DEFAULT false,
      engaged_view_count integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public.promotions (
      id uuid PRIMARY KEY, owner_id uuid, title text, promotion_type text, photos text[],
      videos text[], price_negotiable boolean, contact_methods text[], status text,
      created_at timestamptz, updated_at timestamptz, view_count integer, click_count integer,
      approved_edit_count integer,
      edited_since_review boolean NOT NULL DEFAULT false,
      engaged_view_count integer NOT NULL DEFAULT 0
    );
  `);
  await db.exec(MIGRATION);
});

afterAll(async () => {
  await db.close();
});

async function call(fn: string, data: Record<string, unknown>) {
  const res = await db.query<{ row: Record<string, unknown> }>(
    `SELECT public.${fn}($1::uuid, 'X', -1, $2::jsonb) AS row`,
    [OWNER, JSON.stringify(data)]
  );
  return res.rows[0].row;
}

describe("posting RPCs keep column defaults", () => {
  it("creates a business from a minimal payload", async () => {
    const row = await call("insert_business_with_limit", { business_name: "Example Kitchen" });
    expect(row).toMatchObject({
      owner_id: OWNER,
      business_name: "Example Kitchen",
      area: "MZANSI_BUSINESS",
      status: "draft",
      view_count: 0,
      edited_since_review: false,
      engaged_view_count: 0,
      show_full_registered_office: false,
      category_details: {},
    });
    expect(row.id).toBeTruthy();
  });

  it("creates a listing with array and boolean defaults", async () => {
    const row = await call("insert_listing_with_limit", { title: "Bicycle", featured: null });
    expect(row).toMatchObject({
      owner_id: OWNER,
      area: "MZANSI_MARKET",
      videos: [],
      featured: false,
      attributes: {},
      edited_since_review: false,
    });
  });

  it("creates a promotion and keeps values the payload sends", async () => {
    const row = await call("insert_promotion_with_limit", {
      title: "Festival",
      status: "pending_moderation",
      contact_methods: ["whatsapp"],
    });
    expect(row).toMatchObject({
      status: "pending_moderation",
      contact_methods: ["whatsapp"],
      promotion_type: "general",
      engaged_view_count: 0,
    });
  });

  it("forces the owner to the caller", async () => {
    const row = await call("insert_business_with_limit", {
      business_name: "Hijack",
      owner_id: "00000000-0000-0000-0000-0000000000ff",
    });
    expect(row.owner_id).toBe(OWNER);
  });

  it("refuses tables other than the three posting tables", async () => {
    await expect(
      db.query(`SELECT public.insert_jsonb_row('auth_users', '{"id":"x"}'::jsonb)`)
    ).rejects.toThrow(/unsupported table/);
  });
});
