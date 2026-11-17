/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import type { FoundationServiceApi } from "./service-api";
import {
  FoundationPhoneError,
  issueFoundationPhoneChallenge,
  verifyFoundationPhoneChallenge,
} from "./phone-verification";
vi.mock("server-only", () => ({}));
vi.mock("../services/sms", () => ({ sendOtpSms: vi.fn() }));
const owner = "00000000-0000-4000-8000-000000000001";
const challenge = "00000000-0000-4000-8000-000000000002";
const phone = "+27820000000";
const environment = { FOUNDATION_PHONE_OTP_KEY: "0123456789abcdef".repeat(4) };
const rpc = vi.fn();
const api = { rpc } as unknown as FoundationServiceApi;
const deliver = vi.fn(async (_phone: string, _code: string) => ({ success: true }));
let storedHash: string;
beforeEach(() => {
  vi.clearAllMocks();
  storedHash = "";
  rpc.mockImplementation(async (name: string, args: Record<string, string>) => {
    if (name === "create_verification_phone_challenge") {
      storedHash = args.p_hash;
      return {
        data: { challenge_id: challenge, expires_at: "2026-10-24T18:00:00+00:00" },
        error: null,
      };
    }
    if (name === "claim_verification_phone_attempt")
      return { data: { challenge_id: challenge, phone, otp_hash: storedHash }, error: null };
    return { data: { verified: true, reused: false, proof_id: challenge }, error: null };
  });
  deliver.mockResolvedValue({ success: true });
});
async function issued() {
  const result = await issueFoundationPhoneChallenge(api, owner, { phone }, environment, deliver);
  return { result, code: deliver.mock.calls[0][1] };
}
it("uses the service RPC and delivers once, while returning neither the code nor its digest", async () => {
  const { result, code } = await issued();
  expect(code).toMatch(/^\d{6}$/);
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(deliver).toHaveBeenCalledWith(phone, code);
  expect(result).toEqual({ challenge_id: challenge, expires_at: "2026-10-24T18:00:00+00:00" });
  expect(storedHash).toMatch(/^v1\.[0-9a-f]{32}\.[0-9a-f]{64}$/);
  expect(storedHash).not.toBe(code);
  expect(rpc).toHaveBeenCalledWith("create_verification_phone_challenge", {
    p_owner: owner,
    p_phone: phone,
    p_hash: storedHash,
  });
  expect(JSON.stringify(result)).not.toContain(storedHash);
});
it("claims a bounded SQL attempt before verifying a real HMAC and finalizing exactly once", async () => {
  const { code } = await issued();
  rpc.mockClear();
  await expect(
    verifyFoundationPhoneChallenge(api, owner, { challenge_id: challenge, code }, environment)
  ).resolves.toEqual({ verified: true });
  expect(rpc.mock.calls.map((call) => call[0])).toEqual([
    "claim_verification_phone_attempt",
    "finalize_verification_phone",
  ]);
  expect(rpc.mock.calls[1][1]).toEqual({
    p_owner: owner,
    p_challenge: challenge,
    p_expected_hash: storedHash,
  });
});
it("a wrong code consumes its claim but cannot reach finalization", async () => {
  const { code } = await issued();
  rpc.mockClear();
  const wrong = code === "000000" ? "000001" : "000000";
  await expect(
    verifyFoundationPhoneChallenge(
      api,
      owner,
      { challenge_id: challenge, code: wrong },
      environment
    )
  ).rejects.toMatchObject({ status: 400 });
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("binds the digest to the verified owner even if a digest from another account were returned", async () => {
  const { code } = await issued();
  rpc.mockClear();
  await expect(
    verifyFoundationPhoneChallenge(api, challenge, { challenge_id: challenge, code }, environment)
  ).rejects.toMatchObject({ status: 400 });
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("does not let a submitted actor selector or non-mobile phone reach a service command", async () => {
  for (const input of [{ phone, owner }, { phone: "+27110000000" }, { phone: "0820000000" }])
    await expect(
      issueFoundationPhoneChallenge(api, owner, input, environment, deliver)
    ).rejects.toMatchObject({ status: 400 });
  expect(rpc).not.toHaveBeenCalled();
  expect(deliver).not.toHaveBeenCalled();
});
it("requires an independent strong server key before creating or checking a challenge", async () => {
  await expect(
    issueFoundationPhoneChallenge(api, owner, { phone }, {}, deliver)
  ).rejects.toMatchObject({ status: 503 });
  await expect(
    verifyFoundationPhoneChallenge(
      api,
      owner,
      { challenge_id: challenge, code: "000000" },
      { FOUNDATION_PHONE_OTP_KEY: "a".repeat(64) }
    )
  ).rejects.toMatchObject({ status: 503 });
  expect(rpc).not.toHaveBeenCalled();
  expect(deliver).not.toHaveBeenCalled();
});
it("does not retry failed delivery or expose a challenge as successfully delivered", async () => {
  deliver.mockResolvedValue({ success: false });
  await expect(issued()).rejects.toMatchObject({ status: 503 });
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledTimes(1);
});
it.each([
  ["phone_in_use", 409],
  ["phone_already_verified", 409],
  ["phone_change_identity_required", 409],
  ["phone_banned", 403],
] as const)("sends no SMS when the database refuses with %s (%s)", async (reason, status) => {
  rpc.mockResolvedValue({ data: null, error: { code: "PT409", details: reason } });
  const refused = await issued().catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(FoundationPhoneError);
  expect(refused).toMatchObject({ status, refusal: reason, changeAllowedFrom: undefined });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(deliver).not.toHaveBeenCalled();
});
it("sends no SMS during the change cooldown and keeps the date the database gives", async () => {
  rpc.mockResolvedValue({
    data: null,
    error: { code: "PT409", details: "phone_change_cooldown", hint: "2026-12-01T09:30:00Z" },
  });
  const refused = (await issued().catch((error: unknown) => error)) as FoundationPhoneError;
  expect(refused).toMatchObject({ status: 409, refusal: "phone_change_cooldown" });
  expect(refused.changeAllowedFrom?.toISOString()).toBe("2026-12-01T09:30:00.000Z");
  expect(deliver).not.toHaveBeenCalled();
});
it.each([null, "", "soon", "2026-12-01"])(
  "ignores a cooldown date that is not a UTC time (%s)",
  async (hint) => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PT409", details: "phone_change_cooldown", hint },
    });
    await expect(issued()).rejects.toMatchObject({
      refusal: "phone_change_cooldown",
      changeAllowedFrom: undefined,
    });
    expect(deliver).not.toHaveBeenCalled();
  }
);
it.each([
  ["PT409", "some_other_reason", 409],
  ["PT409", null, 409],
  ["22023", "phone_in_use", 400],
  ["42501", null, 403],
  ["unavailable", null, 503],
] as const)(
  "a %s refusal with reason %s is not named to the member and sends no SMS",
  async (code, details, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, details } });
    await expect(issued()).rejects.toMatchObject({ status, refusal: undefined });
    expect(deliver).not.toHaveBeenCalled();
  }
);
it("an expired, replaced or used-up code asks for a new code, not 'number in use'", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "PT409" } });
  await expect(
    verifyFoundationPhoneChallenge(
      api,
      owner,
      { challenge_id: challenge, code: "000000" },
      environment
    )
  ).rejects.toMatchObject({ status: 400, refusal: undefined });
  expect(rpc).toHaveBeenCalledTimes(1);
});
it.each([
  ["23505", null, 409, "phone_in_use"],
  ["PT409", "phone_banned", 403, "phone_banned"],
  ["PT409", null, 400, undefined],
  ["42501", null, 403, undefined],
] as const)(
  "a %s (%s) refusal at finalization becomes %s",
  async (code, details, status, refusal) => {
    const { code: otp } = await issued();
    rpc.mockImplementation(async (name: string) =>
      name === "claim_verification_phone_attempt"
        ? { data: { challenge_id: challenge, phone, otp_hash: storedHash }, error: null }
        : { data: null, error: { code, details } }
    );
    await expect(
      verifyFoundationPhoneChallenge(
        api,
        owner,
        { challenge_id: challenge, code: otp },
        environment
      )
    ).rejects.toMatchObject({ status, refusal });
  }
);
it.each([
  ["42501", 403],
  ["unavailable", 503],
] as const)("preserves a %s service refusal without retries", async (code, status) => {
  rpc.mockResolvedValue({ data: null, error: { code } });
  await expect(
    verifyFoundationPhoneChallenge(
      api,
      owner,
      { challenge_id: challenge, code: "000000" },
      environment
    )
  ).rejects.toMatchObject({ status });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(deliver).not.toHaveBeenCalled();
});
it("cannot finalize an inconsistent or malformed stored challenge", async () => {
  rpc.mockResolvedValue({
    data: { challenge_id: owner, phone, otp_hash: "not-a-digest" },
    error: null,
  });
  await expect(
    verifyFoundationPhoneChallenge(
      api,
      owner,
      { challenge_id: challenge, code: "000000" },
      environment
    )
  ).rejects.toMatchObject({ status: 503 });
  expect(rpc).toHaveBeenCalledTimes(1);
});
