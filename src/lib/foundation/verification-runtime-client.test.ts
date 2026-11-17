import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFoundationVerificationStatus } from "./verification-runtime-client";

const rpc = vi.fn();
const status = {
  case_id: "00000000-0000-4000-8000-000000000001",
  version: 2,
  verified: false,
  phone_verified: true,
  locality_confirmed: true,
  submission_pending: false,
  return_reason: "The photo was blurred",
  return_decision: "needs_resubmission",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("readFoundationVerificationStatus", () => {
  it("reads the caller's own verification case through the API function", async () => {
    rpc.mockResolvedValueOnce({ data: status, error: null });
    await expect(readFoundationVerificationStatus({ rpc } as never)).resolves.toEqual(status);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_verification_case", {});
  });

  it("fails closed on a database error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(readFoundationVerificationStatus({ rpc } as never)).rejects.toThrow(
      "Verification status unavailable"
    );
  });

  it.each([
    ["an extra field", { ...status, document_number: "8001015009087" }],
    ["an unknown return decision", { ...status, return_decision: "banned" }],
    ["a missing flag", { ...status, verified: undefined }],
  ])("refuses a status with %s", async (_label, data) => {
    rpc.mockResolvedValueOnce({ data, error: null });
    await expect(readFoundationVerificationStatus({ rpc } as never)).rejects.toThrow();
  });
});
