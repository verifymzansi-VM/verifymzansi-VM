/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import type { FoundationServiceApi } from "./service-api";
import { runFoundationOperationJobs } from "./operation-jobs";
vi.mock("server-only", () => ({}));
vi.mock("../services/email", () => ({ sendPlatformNotice: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001";
const claim = "00000000-0000-4000-8000-000000000002";
const rpc = vi.fn(),
  deliver = vi.fn();
const service = { rpc } as unknown as FoundationServiceApi;
vi.mock("./privacy-notice-job", () => ({ runFoundationPrivacyNotice: vi.fn(async () => "empty") }));
const job = () => ({
  id,
  claim_token: claim,
  locked_until: new Date(Date.now() + 90000).toISOString(),
  recipient: "synthetic@example.invalid",
  kind: "payment_completed",
});
beforeEach(() => {
  vi.clearAllMocks();
  deliver.mockResolvedValue({ success: true });
  rpc.mockImplementation(async (name) => ({
    data:
      name === "claim_supported_notification_outbox"
        ? [job()]
        : name === "complete_notification_outbox"
          ? true
          : {},
    error: null,
  }));
});
it("runs bounded domain maintenance and acknowledges only the claimed event", async () => {
  expect(await runFoundationOperationJobs(service, deliver)).toEqual({
    claimed: 1,
    succeeded: 1,
    retrying: 0,
  });
  expect(deliver).toHaveBeenCalledExactlyOnceWith(
    "synthetic@example.invalid",
    "payment_completed",
    `foundation-outbox/${id}`
  );
  expect(rpc).toHaveBeenCalledWith("complete_notification_outbox", {
    p_id: id,
    p_claim: claim,
    p_ok: true,
    p_error: undefined,
  });
  expect(rpc.mock.calls.slice(0, 4).map(([name]) => name)).toEqual([
    "run_post_lifecycle",
    "sweep_sponsorships",
    "purge_expired_inbox",
    "reconcile_intro_trials",
  ]);
});
it("does not send or acknowledge an expired lease", async () => {
  rpc.mockImplementation(async (name) => ({
    data:
      name === "claim_supported_notification_outbox"
        ? [{ ...job(), locked_until: "2000-01-01T00:00:00Z" }]
        : {},
    error: null,
  }));
  expect(await runFoundationOperationJobs(service, deliver)).toEqual({
    claimed: 1,
    succeeded: 0,
    retrying: 1,
  });
  expect(deliver).not.toHaveBeenCalled();
  expect(rpc.mock.calls.some(([name]) => name === "complete_notification_outbox")).toBe(false);
});
it("records only a safe retry reason when provider delivery fails", async () => {
  deliver.mockRejectedValue(new Error("PRIVATE_PROVIDER_RESPONSE"));
  expect(await runFoundationOperationJobs(service, deliver)).toEqual({
    claimed: 1,
    succeeded: 0,
    retrying: 1,
  });
  expect(rpc).toHaveBeenLastCalledWith("complete_notification_outbox", {
    p_id: id,
    p_claim: claim,
    p_ok: false,
    p_error: "delivery_failed",
  });
});
it("stops before delivery when domain maintenance is unavailable", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
  await expect(runFoundationOperationJobs(service, deliver)).rejects.toThrow(
    "scheduled foundation transaction failed"
  );
  expect(deliver).not.toHaveBeenCalled();
});
it("claims only declared supported kinds and passes the owner warning reason to delivery", async () => {
  rpc.mockImplementation(async (name) => ({
    data:
      name === "claim_supported_notification_outbox"
        ? [
            {
              ...job(),
              kind: "account_warning",
              notice_reason: "Actual independent warning reason",
            },
          ]
        : name === "complete_notification_outbox"
          ? true
          : {},
    error: null,
  }));
  expect(await runFoundationOperationJobs(service, deliver)).toMatchObject({ succeeded: 1 });
  expect(rpc).toHaveBeenCalledWith("claim_supported_notification_outbox", {
    p_limit: 1,
    p_supported_kinds: expect.arrayContaining([
      "account_warning",
      "enquiry_received",
      "payment_completed",
    ]),
  });
  expect(deliver).toHaveBeenCalledExactlyOnceWith(
    "synthetic@example.invalid",
    "account_warning",
    `foundation-outbox/${id}`,
    "Actual independent warning reason"
  );
});
it("refuses a warning with missing details before sending or acknowledging it", async () => {
  rpc.mockImplementation(async (name) => ({
    data:
      name === "claim_supported_notification_outbox" ? [{ ...job(), kind: "account_warning" }] : {},
    error: null,
  }));
  await expect(runFoundationOperationJobs(service, deliver)).rejects.toThrow();
  expect(deliver).not.toHaveBeenCalled();
  expect(rpc.mock.calls.some(([name]) => name === "complete_notification_outbox")).toBe(false);
});
it("acknowledges a removed recipient without sending a warning or requiring erased details", async () => {
  rpc.mockImplementation(async (name) => ({
    data:
      name === "claim_supported_notification_outbox"
        ? [{ ...job(), kind: "account_warning", recipient: null, notice_reason: null }]
        : name === "complete_notification_outbox"
          ? true
          : {},
    error: null,
  }));
  expect(await runFoundationOperationJobs(service, deliver)).toMatchObject({ succeeded: 1 });
  expect(deliver).not.toHaveBeenCalled();
});
