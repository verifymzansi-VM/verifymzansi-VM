// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const db = new PGlite();
const user = "00000000-0000-0000-0000-000000000001";
beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TYPE public.verification_step_type AS ENUM ('phone', 'id_doc', 'selfie', 'location');
    CREATE TABLE public.kyc_artifacts (user_id uuid, step_type public.verification_step_type, created_at timestamptz DEFAULT now());
  `);
  await db.exec(readFileSync("supabase/migrations/20260226000000_velocity_rate_limit.sql", "utf8"));
}, 30_000);
afterAll(async () => {
  await db.close();
});

describe("KYC velocity database function", () => {
  it("reproduces the enum/text error and repairs the real function with the migration", async () => {
    await expect(
      db.query("SELECT public.check_kyc_velocity($1::uuid, 'selfie')", [user])
    ).rejects.toThrow(/operator does not exist/);
    await db.exec(
      readFileSync("supabase/migrations/20260906134500_fix_kyc_velocity_step_type.sql", "utf8")
    );
    const result = await db.query<{ allowed: boolean }>(
      "SELECT public.check_kyc_velocity($1::uuid, 'selfie') AS allowed",
      [user]
    );
    expect(result.rows[0].allowed).toBe(true);

    await db.query(
      "INSERT INTO public.kyc_artifacts (user_id, step_type) VALUES ($1, 'selfie'), ($1, 'selfie'), ($1, 'selfie')",
      [user]
    );
    const capped = await db.query<{ allowed: boolean }>(
      "SELECT public.check_kyc_velocity($1::uuid, 'selfie') AS allowed",
      [user]
    );
    expect(capped.rows[0].allowed).toBe(false);
    const otherStep = await db.query<{ allowed: boolean }>(
      "SELECT public.check_kyc_velocity($1::uuid, 'id_doc') AS allowed",
      [user]
    );
    expect(otherStep.rows[0].allowed).toBe(true);

    await db.exec("UPDATE public.kyc_artifacts SET created_at = now() - interval '25 hours'");
    const expired = await db.query<{ allowed: boolean }>(
      "SELECT public.check_kyc_velocity($1::uuid, 'selfie') AS allowed",
      [user]
    );
    expect(expired.rows[0].allowed).toBe(true);
    await expect(
      db.query("SELECT public.check_kyc_velocity($1::uuid, 'invalid-step')", [user])
    ).rejects.toThrow(/invalid input value/);

    const permissions = await db.query<{ role: string; can_execute: boolean }>(
      `SELECT rolname AS role, has_function_privilege(rolname, 'public.check_kyc_velocity(uuid,text,integer)', 'EXECUTE') AS can_execute FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') ORDER BY rolname`
    );
    expect(permissions.rows).toEqual([
      { role: "anon", can_execute: false },
      { role: "authenticated", can_execute: false },
      { role: "service_role", can_execute: true },
    ]);
  });
});
