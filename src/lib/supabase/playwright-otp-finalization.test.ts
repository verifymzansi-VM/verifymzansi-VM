import { beforeEach, describe, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));
vi.mock("./playwright-fixture-store", () => ({
  listPlaywrightTableRows: (table: string) => structuredClone(store.tables[table] ?? []),
  writePlaywrightTableRows: (table: string, rows: Record<string, unknown>[]) => {
    store.tables[table] = rows;
  },
}));
import { finalizePlaywrightOtp } from "./playwright-otp-finalization";
const params = {
  p_user_id: "member",
  p_challenge_id: "challenge",
  p_expected_hash: "synthetic-hash",
  p_phone: "+27821234567",
};
beforeEach(() => {
  store.tables = {
    account_profiles: [
      {
        user_id: "member",
        phone: null,
        pending_phone: params.p_phone,
        account_status: "active",
        account_verification_status: "incomplete",
      },
    ],
    otp_challenges: [
      {
        id: "challenge",
        user_id: "member",
        phone: params.p_phone,
        otp_hash: params.p_expected_hash,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        attempt_count: 1,
      },
    ],
    verification_steps: [],
    verification_sessions: [],
    otp_logs: [{ phone: params.p_phone, otp_hash: params.p_expected_hash }],
  };
});
describe("browser OTP finalization model", () => {
  it("updates the profile, phone step, session and audit together, and deduplicates replay", () => {
    expect(finalizePlaywrightOtp(params).data.outcome).toBe("verified");
    const before = structuredClone(store.tables);
    expect(finalizePlaywrightOtp(params).data.outcome).toBe("already_verified");
    expect(store.tables).toEqual(before);
    expect(store.tables.verification_steps[0]).toMatchObject({
      user_id: "member",
      status: "approved",
    });
    expect(store.tables.account_profiles[0]).toMatchObject({
      phone: params.p_phone,
      pending_phone: null,
    });
  });
  it("keeps all fixture rows intact for wrong users, hashes, stale staging and expired challenges", () => {
    const before = structuredClone(store.tables);
    expect(finalizePlaywrightOtp({ ...params, p_expected_hash: "wrong" }).data.outcome).toBe(
      "invalid_challenge"
    );
    expect(finalizePlaywrightOtp({ ...params, p_user_id: "another" }).data.outcome).toBe(
      "profile_missing"
    );
    expect(store.tables).toEqual(before);
    store.tables.account_profiles[0].pending_phone = "+27829990000";
    const staged = structuredClone(store.tables);
    expect(finalizePlaywrightOtp(params).data.outcome).toBe("invalid_challenge");
    expect(store.tables).toEqual(staged);
    store.tables.account_profiles[0].pending_phone = params.p_phone;
    store.tables.otp_challenges[0].expires_at = new Date(Date.now() - 1000).toISOString();
    expect(finalizePlaywrightOtp(params).data.outcome).toBe("invalid_challenge");
  });
});
