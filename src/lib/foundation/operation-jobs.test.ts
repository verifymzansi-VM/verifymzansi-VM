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
      name === "claim_notification_outbox"
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
      name === "claim_notification_outbox"
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
