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
it("declares and delivers the sold-post notice within the database's kind limit", async () => {
  rpc.mockImplementation(async (name) => ({
    data:
      name === "claim_supported_notification_outbox"
        ? [{ ...job(), kind: "post_sold" }]
        : name === "complete_notification_outbox"
          ? true
          : {},
    error: null,
  }));
  expect(await runFoundationOperationJobs(service, deliver)).toMatchObject({ succeeded: 1 });
  const claimArgs = rpc.mock.calls.find(([name]) => name === "claim_supported_notification_outbox");
  expect(claimArgs?.[1].p_supported_kinds).toEqual(
    expect.arrayContaining(["post_sold", "post_kept"])
  );
  expect(claimArgs?.[1].p_supported_kinds).toHaveLength(19);
  expect(deliver).toHaveBeenCalledExactlyOnceWith(
    "synthetic@example.invalid",
    "post_sold",
    `foundation-outbox/${id}`,
    undefined,
    { deletesAt: null, holdsSlot: null }
  );
});
it("passes the deletion date and slot of a lifecycle notice to the email", async () => {
  rpc.mockImplementation(async (name) => ({
    data:
      name === "claim_supported_notification_outbox"
        ? [
            {
              ...job(),
              kind: "post_expired",
              deletes_at: "2026-11-12T08:30:00+00:00",
              holds_slot: false,
            },
          ]
        : name === "complete_notification_outbox"
          ? true
          : {},
    error: null,
  }));
  expect(await runFoundationOperationJobs(service, deliver)).toMatchObject({ succeeded: 1 });
  expect(deliver).toHaveBeenCalledExactlyOnceWith(
    "synthetic@example.invalid",
    "post_expired",
    `foundation-outbox/${id}`,
    undefined,
    { deletesAt: "2026-11-12T08:30:00+00:00", holdsSlot: false }
  );
});
it("claims the earlier kinds from a database that does not know the newer ones", async () => {
  let first = true;
  rpc.mockImplementation(async (name) => {
    if (name === "claim_supported_notification_outbox" && first) {
      first = false;
      return { data: null, error: { code: "22023", message: "unsupported mail kind" } };
    }
    return {
      data:
        name === "claim_supported_notification_outbox"
          ? [job()]
          : name === "complete_notification_outbox"
            ? true
            : {},
      error: null,
    };
  });
  expect(await runFoundationOperationJobs(service, deliver)).toMatchObject({ succeeded: 1 });
  const claims = rpc.mock.calls.filter(([name]) => name === "claim_supported_notification_outbox");
  expect(claims).toHaveLength(2);
  expect(claims[1][1].p_supported_kinds).toHaveLength(17);
  expect(claims[1][1].p_supported_kinds).not.toContain("post_sold");
  expect(claims[1][1].p_supported_kinds).not.toContain("post_kept");
});
it("claims the earlier kinds when the earlier database refuses the list's length", async () => {
  let first = true;
  rpc.mockImplementation(async (name) => {
    if (name === "claim_supported_notification_outbox" && first) {
      first = false;
      return { data: null, error: { code: "22023", message: "supported mail kinds required" } };
    }
    return { data: name === "claim_supported_notification_outbox" ? [] : {}, error: null };
  });
  expect(await runFoundationOperationJobs(service, deliver)).toMatchObject({ claimed: 0 });
  const claims = rpc.mock.calls.filter(([name]) => name === "claim_supported_notification_outbox");
  expect(claims.map(([, args]) => args.p_supported_kinds.length)).toEqual([19, 17]);
});
it("does not retry the claim after another invalid-parameter refusal", async () => {
  rpc.mockImplementation(async (name) =>
    name === "claim_supported_notification_outbox"
      ? { data: null, error: { code: "22023", message: "invalid limit" } }
      : { data: {}, error: null }
  );
  await expect(runFoundationOperationJobs(service, deliver)).rejects.toThrow(
    "could not be claimed"
  );
  expect(
    rpc.mock.calls.filter(([name]) => name === "claim_supported_notification_outbox")
  ).toHaveLength(1);
});
it("does not retry the claim after another failure", async () => {
  rpc.mockImplementation(async (name) =>
    name === "claim_supported_notification_outbox"
      ? { data: null, error: { code: "42501", message: "denied" } }
      : { data: {}, error: null }
  );
  await expect(runFoundationOperationJobs(service, deliver)).rejects.toThrow(
    "could not be claimed"
  );
  expect(
    rpc.mock.calls.filter(([name]) => name === "claim_supported_notification_outbox")
  ).toHaveLength(1);
});
