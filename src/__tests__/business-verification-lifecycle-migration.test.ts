// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const OWNER = "00000000-0000-0000-0000-00000000000a";
const HELD = "00000000-0000-0000-0000-00000000000b";

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
    CREATE TABLE public.notifications (user_id uuid, type text, title text, message text, href text);
    CREATE TABLE public.r2_cleanup_queue (bucket text, r2_key text, reason text, processed_at timestamptz);
    INSERT INTO auth.users VALUES ('${OWNER}'), ('${HELD}');
    INSERT INTO public.account_profiles VALUES ('${OWNER}', false), ('${HELD}', true);
  `);
  await db.exec(read("20261006124457_business_verifications.sql"));
  await db.exec(read("20261006124635_business_verification_lifecycle.sql"));
});

afterAll(async () => {
  await db.close();
});

async function scalar<T>(sql: string): Promise<T> {
  const res = await db.query<{ v: T }>(sql);
  return res.rows[0].v;
}

describe("run_business_verification_lifecycle", () => {
  it("expires stickers, reminds before expiry, closes silent cases and purges files", async () => {
    await db.exec(`
      INSERT INTO public.businesses (id, owner_id, cipc_verified_at, cipc_expires_at, cipc_registration_number, owner_verified_role)
        VALUES ('10000000-0000-0000-0000-000000000001', '${OWNER}', now() - interval '400 days', now() - interval '1 day', '2020/123456/07', 'director'),
               ('10000000-0000-0000-0000-000000000002', '${OWNER}', now(), now() + interval '29 days 12 hours', '2021/123456/07', 'director');
      INSERT INTO public.business_verifications (id, business_id, owner_id, kind, status, registration_number, expires_at, decided_at, updated_at)
        VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '${OWNER}', 'cipc', 'approved', '2020/123456/07', now() - interval '1 day', now() - interval '400 days', now()),
               ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '${OWNER}', 'cipc', 'rejected', '2021/123456/07', NULL, now() - interval '40 days', now());
      INSERT INTO public.business_verification_files (case_id, kind, uploaded_by, r2_key, content_type, size_bytes, sha256)
        VALUES ('20000000-0000-0000-0000-000000000002', 'owner_upload', '${OWNER}', 'kyc/business-cipc/old.bin', 'application/pdf', 10, 'x');
    `);
    // A case waiting on the owner for over 30 days. The updated_at trigger would
    // reset the timestamp, so disable it for the backdating insert.
    await db.exec(`
      ALTER TABLE public.business_verifications DISABLE TRIGGER set_business_verifications_updated_at;
      INSERT INTO public.business_verifications (id, business_id, owner_id, kind, status, registration_number, updated_at)
        VALUES ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '${OWNER}', 'seen', 'info_requested', NULL, now() - interval '31 days');
      ALTER TABLE public.business_verifications ENABLE TRIGGER set_business_verifications_updated_at;
    `);

    // The rejected case closed 40 days ago, so its file is scheduled and
    // purged in the same run; a second run finds nothing more to do.
    const result = await scalar<Record<string, number>>(
      `SELECT public.run_business_verification_lifecycle() AS v`
    );
    expect(result).toMatchObject({ purged: 1, closed: 1, expired: 1, reminded: 1 });
    const again = await scalar<Record<string, number>>(
      `SELECT public.run_business_verification_lifecycle() AS v`
    );
    expect(again).toMatchObject({ purged: 0, closed: 0, expired: 0 });

    expect(
      await scalar<string | null>(
        `SELECT cipc_verified_at::text AS v FROM public.businesses WHERE id = '10000000-0000-0000-0000-000000000001'`
      )
    ).toBeNull();
    expect(
      await scalar<string>(
        `SELECT status AS v FROM public.business_verifications WHERE id = '20000000-0000-0000-0000-000000000001'`
      )
    ).toBe("expired");
    expect(
      await scalar<string>(
        `SELECT status AS v FROM public.business_verifications WHERE id = '20000000-0000-0000-0000-000000000003'`
      )
    ).toBe("withdrawn");
    const titles = (
      await db.query<{ title: string }>(`SELECT title FROM public.notifications`)
    ).rows.map((r) => r.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "CIPC sticker expired",
        "Renew your CIPC sticker",
        "Business verification closed",
      ])
    );
    expect(await scalar<string>(`SELECT r2_key AS v FROM public.r2_cleanup_queue`)).toBe(
      "kyc/business-cipc/old.bin"
    );
  });

  it("keeps files of owners on legal hold", async () => {
    await db.exec(`
      INSERT INTO public.businesses (id, owner_id) VALUES ('10000000-0000-0000-0000-000000000009', '${HELD}');
      INSERT INTO public.business_verifications (id, business_id, owner_id, kind, status, registration_number, decided_at)
        VALUES ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000009', '${HELD}', 'cipc', 'rejected', '2022/123456/07', now() - interval '60 days');
      INSERT INTO public.business_verification_files (case_id, kind, uploaded_by, r2_key, content_type, size_bytes, sha256, purge_after)
        VALUES ('20000000-0000-0000-0000-000000000009', 'owner_upload', '${HELD}', 'kyc/business-cipc/held.bin', 'application/pdf', 10, 'y', now() - interval '1 day');
    `);
    await db.query(`SELECT public.run_business_verification_lifecycle()`);
    expect(
      await scalar<string | null>(
        `SELECT purged_at::text AS v FROM public.business_verification_files WHERE r2_key = 'kyc/business-cipc/held.bin'`
      )
    ).toBeNull();
  });
});
