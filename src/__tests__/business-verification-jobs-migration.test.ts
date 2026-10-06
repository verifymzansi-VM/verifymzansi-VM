// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const OWNER = "00000000-0000-0000-0000-00000000000a";
const BUYER = "00000000-0000-0000-0000-00000000000b";
const MAIN = "00000000-0000-0000-0000-0000000000b1";
const BRANCH = "00000000-0000-0000-0000-0000000000b2";
const SHOP = "00000000-0000-0000-0000-0000000000b3";
const NUMBER = "2020/123456/07";

const db = new PGlite();

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION public.has_any_role(r text[]) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    CREATE TABLE public.businesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid);
    CREATE TABLE public.account_profiles (user_id uuid PRIMARY KEY, legal_hold boolean NOT NULL DEFAULT false);
    CREATE TABLE public.notifications (
      user_id uuid, type text, title text, message text, href text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.r2_cleanup_queue (bucket text, r2_key text, reason text, processed_at timestamptz);
    INSERT INTO auth.users VALUES ('${OWNER}'), ('${BUYER}');
    INSERT INTO public.account_profiles VALUES ('${OWNER}', false), ('${BUYER}', false);
  `);
  await db.exec(read("20261006124457_business_verifications.sql"));
  await db.exec(read("20261006124635_business_verification_lifecycle.sql"));
  await db.exec(read("20261006225629_business_verification_jobs_and_ownership.sql"));

  // A company verified on MAIN, a BRANCH linked to it, and a SHOP with Seen.
  await db.exec(`
    INSERT INTO public.businesses (id, owner_id) VALUES ('${MAIN}', '${OWNER}'), ('${BRANCH}', '${OWNER}'), ('${SHOP}', '${OWNER}');
    UPDATE public.businesses SET cipc_verified_at = now(), cipc_registration_number = '${NUMBER}',
      cipc_expires_at = now() + interval '10 days' WHERE id IN ('${MAIN}', '${BRANCH}');
    UPDATE public.businesses SET seen_verified_at = now(), seen_method = 'video',
      seen_expires_at = now() + interval '12 days' WHERE id = '${SHOP}';
    INSERT INTO public.business_verifications (id, business_id, owner_id, kind, status, registration_number)
      VALUES ('00000000-0000-0000-0000-0000000000c1', '${MAIN}', '${OWNER}', 'cipc', 'approved', '${NUMBER}');
    INSERT INTO public.business_verifications (business_id, owner_id, kind, status, registration_number, linked_case_id)
      VALUES ('${BRANCH}', '${OWNER}', 'cipc_link', 'approved', '${NUMBER}', '00000000-0000-0000-0000-0000000000c1');
  `);
});

afterAll(async () => {
  await db.close();
});

async function count(title: string, businessId?: string): Promise<number> {
  const res = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.notifications WHERE title = $1 AND ($2::text IS NULL OR href LIKE '%' || $2 || '%')`,
    [title, businessId ?? null]
  );
  return res.rows[0].n;
}

describe("business verification jobs", () => {
  it("reminds each company once, not each linked profile, and not again the next day", async () => {
    await db.exec(`SELECT public.run_business_verification_lifecycle()`);
    expect(await count("Renew your CIPC sticker", MAIN)).toBe(1);
    expect(await count("Renew your CIPC sticker", BRANCH)).toBe(0);
    await db.exec(`SELECT public.run_business_verification_lifecycle()`);
    expect(await count("Renew your CIPC sticker")).toBe(1);
  });

  it("reminds Seen holders to book their next check", async () => {
    expect(await count("Book your next Seen check", SHOP)).toBe(1);
  });

  it("skips the reminder while a renewal is already open", async () => {
    await db.exec(`
      DELETE FROM public.notifications;
      INSERT INTO public.business_verifications (business_id, owner_id, kind, status, registration_number)
        VALUES ('${MAIN}', '${OWNER}', 'cipc', 'pending', '${NUMBER}');
      SELECT public.run_business_verification_lifecycle();
    `);
    expect(await count("Renew your CIPC sticker", MAIN)).toBe(0);
  });

  it("removes the sticker from linked profiles when the company changes owner", async () => {
    await db.exec(`UPDATE public.businesses SET owner_id = '${BUYER}' WHERE id = '${MAIN}'`);
    const branch = await db.query<{ v: string | null }>(
      `SELECT cipc_verified_at::text AS v FROM public.businesses WHERE id = '${BRANCH}'`
    );
    expect(branch.rows[0].v).toBeNull();
    const link = await db.query<{ status: string; reason_code: string; decided: boolean }>(
      `SELECT status, reason_code, decided_at IS NOT NULL AS decided
         FROM public.business_verifications WHERE business_id = '${BRANCH}'`
    );
    expect(link.rows[0]).toEqual({
      status: "revoked",
      reason_code: "source_owner_changed",
      decided: true,
    });
  });
});
