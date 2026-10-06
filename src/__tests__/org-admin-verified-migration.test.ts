// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  "supabase/migrations/20261006093026_org_admin_requires_verified.sql",
  "utf8"
);

const ORG = "00000000-0000-0000-0000-0000000000a1";
const ADMIN = "00000000-0000-0000-0000-0000000000b1";

const db = new PGlite();

beforeAll(async () => {
  await db.exec(`
    CREATE TABLE public.organisations (id uuid PRIMARY KEY, programme_status text NOT NULL);
    CREATE TABLE public.organisation_admins (organisation_id uuid, user_id uuid);
    CREATE TABLE public.account_profiles (
      user_id uuid PRIMARY KEY, account_verification_status text, account_status text
    );
    INSERT INTO public.organisations VALUES ('${ORG}', 'active_paid');
    INSERT INTO public.organisation_admins VALUES ('${ORG}', '${ADMIN}');
    INSERT INTO public.account_profiles VALUES ('${ADMIN}', 'verified', 'active');
  `);
  await db.exec(MIGRATION);
});

afterAll(async () => {
  await db.close();
});

async function isAdmin(): Promise<boolean> {
  const res = await db.query<{ ok: boolean }>(
    `SELECT public.is_organisation_admin('${ORG}', '${ADMIN}') AS ok`
  );
  return res.rows[0].ok;
}

async function setProfile(verification: string, status: string) {
  await db.exec(
    `UPDATE public.account_profiles SET account_verification_status = '${verification}', account_status = '${status}'`
  );
}

describe("is_organisation_admin", () => {
  it("allows a verified, active admin", async () => {
    await setProfile("verified", "active");
    expect(await isAdmin()).toBe(true);
  });

  it("denies an admin whose verification was revoked", async () => {
    await setProfile("rejected", "active");
    expect(await isAdmin()).toBe(false);
  });

  it("denies a suspended or banned admin", async () => {
    await setProfile("verified", "suspended");
    expect(await isAdmin()).toBe(false);
    await setProfile("verified", "banned");
    expect(await isAdmin()).toBe(false);
  });

  it("denies admins of an ended programme", async () => {
    await setProfile("verified", "active");
    await db.exec(`UPDATE public.organisations SET programme_status = 'ended'`);
    expect(await isAdmin()).toBe(false);
  });
});
