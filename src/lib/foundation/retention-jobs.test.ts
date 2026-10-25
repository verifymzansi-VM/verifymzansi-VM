/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import type { FoundationServiceApi } from "./service-api";
import { runFoundationRetention } from "./retention-jobs";
vi.mock("server-only", () => ({}));
vi.mock("../services/storage", () => ({ deleteFromR2: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const token = "00000000-0000-4000-8000-000000000003";
const rpc = vi.fn(),
  remove = vi.fn();
const service = { rpc } as unknown as FoundationServiceApi;
const shared = () => ({
  claim_token: token,
  lease_until: new Date(Date.now() + 300000).toISOString(),
});
const media = () => ({ ...shared(), object_id: id, object_key: `media/${id}` });
const evidence = () => ({ ...shared(), artifact_id: other, object_key: `evidence/${id}/${other}` });
beforeEach(() => {
  vi.clearAllMocks();
  remove.mockResolvedValue(undefined);
  rpc.mockImplementation(async (name) => ({
    data:
      name === "claim_media_cleanup"
        ? [media()]
        : name === "claim_evidence_cleanup"
          ? [evidence()]
          : true,
    error: null,
  }));
});
it("deletes only journal-claimed keys and display variants, then uses token-fenced acknowledgements", async () => {
  expect(await runFoundationRetention(service, remove)).toEqual({
    claimed: 2,
    deleted: 2,
    retrying: 0,
  });
  expect(remove).toHaveBeenCalledWith(expect.any(String), `media/${id}`);
  expect(remove).toHaveBeenCalledWith(expect.any(String), `evidence/${id}/${other}`);
  expect(rpc).toHaveBeenCalledWith("mark_media_deleted", { p_object_id: id, p_claim_token: token });
  expect(rpc).toHaveBeenCalledWith("mark_evidence_deleted", {
    p_artifact: other,
    p_claim_token: token,
  });
});
it("does not acknowledge failed object deletion", async () => {
  remove.mockRejectedValue(new Error("storage unavailable"));
  expect(await runFoundationRetention(service, remove)).toEqual({
    claimed: 2,
    deleted: 0,
    retrying: 2,
  });
  expect(rpc.mock.calls.some(([name]) => name.startsWith("mark_"))).toBe(false);
});
it("waits for all work and records an uncertain acknowledgement for retry", async () => {
  rpc.mockImplementation(async (name) => {
    if (name === "mark_media_deleted") throw new Error("network unavailable");
    return {
      data:
        name === "claim_media_cleanup"
          ? [media()]
          : name === "claim_evidence_cleanup"
            ? [evidence()]
            : true,
      error: null,
    };
  });
  expect(await runFoundationRetention(service, remove)).toEqual({
    claimed: 2,
    deleted: 1,
    retrying: 1,
  });
  expect(rpc).toHaveBeenCalledWith("mark_evidence_deleted", {
    p_artifact: other,
    p_claim_token: token,
  });
});
it("refuses unbounded or unrecognised object paths before any R2 deletion", async () => {
  rpc.mockImplementation(async (name) => ({
    data:
      name === "claim_media_cleanup"
        ? [{ ...media(), object_key: "old-archive/private-document" }]
        : name === "claim_evidence_cleanup"
          ? []
          : true,
    error: null,
  }));
  await expect(runFoundationRetention(service, remove)).rejects.toThrow();
  expect(remove).not.toHaveBeenCalled();
});
