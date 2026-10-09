// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const db = new PGlite();
const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const challenge = "00000000-0000-4000-8000-000000000003";
const phone = "+27821234567";
const hash = "synthetic-tested-hash";
const migration = readFileSync(
  "supabase/migrations/20261009063011_atomic_otp_phone_finalization.sql",
  "utf8"
);
const helpers = readFileSync(
  "supabase/migrations/20260307173000_normalize_seller_profile_phones.sql",
  "utf8"
).split("CREATE OR REPLACE FUNCTION public.sync_seller_profile_phone_fields")[0];
const finish = async (actor = user, expected = hash) =>
  (
    await db.query<{ result: { outcome: string; phone_changed?: boolean; retry_after?: number } }>(
      "SELECT public.finalize_otp_phone_verification($1,$2,$3,$4) AS result",
      [actor, challenge, expected, phone]
    )
  ).rows[0].result;
async function snapshot() {
  const result: Array<Array<{ row: Record<string, unknown> }>> = [];
  for (const table of [
    "account_profiles",
    "otp_challenges",
    "verification_steps",
    "verification_sessions",
    "otp_logs",
  ])
    result.push(
      (
        await db.query<{ row: Record<string, unknown> }>(
          `SELECT to_jsonb(t) AS row FROM public.${table} t`
        )
      ).rows
    );
  return result;
}
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.account_profiles(user_id uuid PRIMARY KEY, phone text UNIQUE, masked_phone_public text,
      pending_phone text, account_status text DEFAULT 'active', suspended_until timestamptz,
      account_verification_status text DEFAULT 'verified', contact_last_phone_change_at timestamptz);
    CREATE TABLE public.otp_challenges(id uuid PRIMARY KEY, user_id uuid, phone text, otp_hash text,
      expires_at timestamptz, verified_at timestamptz, attempt_count integer);
    CREATE TABLE public.verification_steps(user_id uuid, step_type text, status text, phone_verified_at timestamptz,
      PRIMARY KEY(user_id,step_type));
    CREATE TABLE public.verification_sessions(user_id uuid PRIMARY KEY, phone_verified_at timestamptz, finalized_at timestamptz);
    CREATE TABLE public.otp_logs(phone text, otp_hash text, verified boolean DEFAULT false, verified_at timestamptz);
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`);
  await db.exec(helpers);
  await db.exec(migration);
}, 30_000);
beforeEach(async () => {
  await db.exec(
    "RESET ROLE; TRUNCATE account_profiles, otp_challenges, verification_steps, verification_sessions, otp_logs; DROP TRIGGER IF EXISTS test_failure ON verification_sessions; DROP TRIGGER IF EXISTS test_failure ON otp_logs;"
  );
  await db.query("INSERT INTO account_profiles(user_id,pending_phone) VALUES($1,$2)", [
    user,
    phone,
  ]);
  await db.query(
    "INSERT INTO otp_challenges VALUES($1,$2,$3,$4,now()+interval '10 minutes',null,1)",
    [challenge, user, phone, hash]
  );
  await db.query("INSERT INTO otp_logs(phone,otp_hash) VALUES($1,$2)", [phone, hash]);
});
afterAll(async () => {
  await db.close();
});

describe("atomic OTP phone finalization", () => {
  it("commits all state and retries without restamping it", async () => {
    await db.exec("SET ROLE service_role");
    expect(await finish()).toEqual({ outcome: "verified", phone_changed: false });
    const state = await snapshot();
    expect(await finish()).toEqual({ outcome: "already_verified", phone_changed: false });
    expect(await snapshot()).toEqual(state);
    expect(
      (
        await db.query<{ phone: string; pending_phone: null }>(
          "SELECT phone,pending_phone FROM account_profiles"
        )
      ).rows[0]
    ).toEqual({ phone, pending_phone: null });
    const dates = await db.query<{ same: boolean }>(`SELECT c.verified_at = s.phone_verified_at
      AND c.verified_at = v.phone_verified_at AND c.verified_at = l.verified_at AS same
      FROM otp_challenges c,verification_steps s,verification_sessions v,otp_logs l`);
    expect(dates.rows[0].same).toBe(true);
  });
  it.each(["verification_sessions", "otp_logs"])(
    "rolls back the claim and every write if %s fails, then permits retry",
    async (table) => {
      await db.exec(`CREATE OR REPLACE FUNCTION public.test_reject_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected write failure'; END $$;
      CREATE TRIGGER test_failure BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION test_reject_write();`);
      const before = await snapshot();
      await expect(finish()).rejects.toThrow("injected write failure");
      expect(await snapshot()).toEqual(before);
      await db.exec(`DROP TRIGGER test_failure ON ${table}`);
      expect((await finish()).outcome).toBe("verified");
    }
  );
  it.each(["anon", "authenticated"])("rejects direct %s execution", async (role) => {
    await db.exec(`SET ROLE ${role}`);
    await expect(finish()).rejects.toThrow(/permission denied/);
  });
  it.each(["expired", "staged_elsewhere", "banned", "suspended", "unreserved", "exhausted"])(
    "rejects %s without consuming the challenge or changing the phone",
    async (state) => {
      if (state === "expired")
        await db.exec("UPDATE otp_challenges SET expires_at=now()-interval '1 second'");
      if (state === "staged_elsewhere")
        await db.exec("UPDATE account_profiles SET pending_phone='+27829990000'");
      if (state === "banned" || state === "suspended")
        await db.query("UPDATE account_profiles SET account_status=$1", [state]);
      if (state === "unreserved" || state === "exhausted")
        await db.query("UPDATE otp_challenges SET attempt_count=$1", [
          state === "unreserved" ? 0 : 6,
        ]);
      const before = await snapshot();
      expect((await finish()).outcome).toBe(
        ["banned", "suspended"].includes(state) ? "account_restricted" : "invalid_challenge"
      );
      expect(await snapshot()).toEqual(before);
    }
  );
  it("binds the verified hash and user to the challenge", async () => {
    const before = await snapshot();
    expect((await finish(other)).outcome).toBe("profile_missing");
    await db.query("INSERT INTO account_profiles(user_id) VALUES($1)", [other]);
    expect((await finish(other)).outcome).toBe("invalid_challenge");
    await db.query("DELETE FROM account_profiles WHERE user_id=$1", [other]);
    expect((await finish(user, "different-hash")).outcome).toBe("invalid_challenge");
    expect(await snapshot()).toEqual(before);
  });
  it("rejects an inconsistent replay without repairing state from a consumed challenge", async () => {
    await finish();
    await db.exec("UPDATE verification_steps SET status='pending'");
    const before = await snapshot();
    expect((await finish()).outcome).toBe("invalid_challenge");
    expect(await snapshot()).toEqual(before);
  });
  it("does not consume a challenge when phone uniqueness fails", async () => {
    await db.query("INSERT INTO account_profiles(user_id,phone) VALUES($1,$2)", [other, phone]);
    const before = await snapshot();
    await expect(finish()).rejects.toThrow(/unique constraint/);
    expect(await snapshot()).toEqual(before);
  });
  it("preserves an existing cooldown and finalized session for same-phone verification", async () => {
    await db.exec(
      "UPDATE account_profiles SET phone=pending_phone,contact_last_phone_change_at=now()-interval '1 hour'"
    );
    await db.query(
      "INSERT INTO verification_sessions(user_id,finalized_at) VALUES($1,now()-interval '1 hour')",
      [user]
    );
    const before = await snapshot();
    expect((await finish()).outcome).toBe("verified");
    const after = await snapshot();
    expect(after[0]).toEqual([
      {
        row: {
          ...(before[0][0].row as object),
          pending_phone: null,
          masked_phone_public: expect.any(String),
        },
      },
    ]);
    expect(after[3][0].row).toMatchObject({
      finalized_at: (before[3][0].row as Record<string, unknown>).finalized_at,
    });
  });
  it("rechecks the phone-change verification and cooldown policies at commit time", async () => {
    await db.exec(
      "UPDATE account_profiles SET phone='+27829990000',account_verification_status='incomplete'"
    );
    expect((await finish()).outcome).toBe("phone_reverification_required");
    await db.exec(
      "UPDATE account_profiles SET account_verification_status='verified',contact_last_phone_change_at=now()-interval '1 hour'"
    );
    expect((await finish()).outcome).toBe("phone_cooldown");
    await db.exec(
      "UPDATE account_profiles SET contact_last_phone_change_at=now()-interval '361 hours'"
    );
    expect(await finish()).toEqual({ outcome: "verified", phone_changed: true });
  });
});
