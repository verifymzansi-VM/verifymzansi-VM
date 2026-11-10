/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import type { FoundationServiceApi } from "./service-api";
import { runFoundationPrivacyNotice } from "./privacy-notice-job";
import { sendDsarCompletedEmail } from "../services/email";
vi.mock("server-only", () => ({}));
vi.mock("../services/email", () => ({
  sendDsarCompletedEmail: vi.fn(async () => ({ success: true })),
  sendDsarExtensionEmail: vi.fn(),
  sendDsarRejectedEmail: vi.fn(),
  sendDsarSubmissionEmail: vi.fn(),
}));
const notice = {
  id: "00000000-0000-4000-8000-000000000001",
  request_id: "00000000-0000-4000-8000-000000000002",
  kind: "completed",
  recipient: "synthetic@example.invalid",
  claim_token: "00000000-0000-4000-8000-000000000003",
  locked_until: new Date(Date.now() + 90_000).toISOString(),
  due: null,
  reason: null,
};
const signals: Array<[string, AbortSignal]> = [];
type Answer = { data: unknown; error: { code: string } | null };
const answer = (name: string) => {
  const result: Promise<Answer> = Promise.resolve({
    data: name === "claim_frontend_privacy_notice" ? notice : true,
    error: null,
  });
  return Object.assign(result, {
    abortSignal: (signal: AbortSignal) => {
      signals.push([name, signal]);
      return result;
    },
  });
};
const rpc = vi.fn<(name: string) => Promise<Answer> & { abortSignal: unknown }>(answer);
const service = { rpc } as unknown as FoundationServiceApi;
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(answer);
  signals.length = 0;
});

it("sends a claimed notice and records it with the run's time limit", async () => {
  const signal = new AbortController().signal;
  expect(await runFoundationPrivacyNotice(service, { signal, canSend: () => true })).toBe(
    "succeeded"
  );
  expect(sendDsarCompletedEmail).toHaveBeenCalledOnce();
  expect(signals).toEqual([
    ["claim_frontend_privacy_notice", signal],
    ["complete_frontend_privacy_notice", signal],
  ]);
});

it("gives a claimed notice back without sending when a send no longer fits", async () => {
  expect(await runFoundationPrivacyNotice(service, { canSend: () => false })).toBe("retrying");
  expect(sendDsarCompletedEmail).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenLastCalledWith("complete_frontend_privacy_notice", {
    p_job: notice.id,
    p_claim: notice.claim_token,
    p_delivered: false,
  });
});

it("claims with the claim limit and paces the send", async () => {
  const claimSignal = new AbortController().signal;
  const signal = new AbortController().signal;
  let paced = 0;
  const pace = <T>(send: () => Promise<T>) => {
    paced++;
    return send();
  };
  await runFoundationPrivacyNotice(service, { claimSignal, signal, pace });
  expect(signals).toEqual([
    ["claim_frontend_privacy_notice", claimSignal],
    ["complete_frontend_privacy_notice", signal],
  ]);
  expect(paced).toBe(1);
});

it("reports an outcome that could not be recorded", async () => {
  rpc.mockImplementation((name: string) => {
    const result: Promise<Answer> = Promise.resolve(
      name === "claim_frontend_privacy_notice"
        ? { data: notice, error: null }
        : { data: null, error: { code: "PGRST202" } }
    );
    return Object.assign(result, { abortSignal: () => result });
  });
  await expect(runFoundationPrivacyNotice(service)).rejects.toThrow("could not be recorded");
  expect(sendDsarCompletedEmail).toHaveBeenCalledOnce();
});

it("keeps working without run limits", async () => {
  expect(await runFoundationPrivacyNotice(service)).toBe("succeeded");
  expect(signals).toEqual([]);
});
