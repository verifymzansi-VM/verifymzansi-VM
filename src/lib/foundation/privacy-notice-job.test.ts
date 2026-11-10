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
const rpc = vi.fn((name: string) => {
  const result = Promise.resolve({
    data: name === "claim_frontend_privacy_notice" ? notice : true,
    error: null,
  });
  return Object.assign(result, {
    abortSignal: (signal: AbortSignal) => {
      signals.push([name, signal]);
      return result;
    },
  });
});
const service = { rpc } as unknown as FoundationServiceApi;
beforeEach(() => {
  vi.clearAllMocks();
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

it("keeps working without run limits", async () => {
  expect(await runFoundationPrivacyNotice(service)).toBe("succeeded");
  expect(signals).toEqual([]);
});
