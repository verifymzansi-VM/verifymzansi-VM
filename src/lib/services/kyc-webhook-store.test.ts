/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import {
  findProviderResultByRef,
  updateProviderResult,
  getArtifactStepType,
  getVerificationStepForUserAndType,
  updateVerificationStepRiskDecision,
} from "./kyc-webhook-store";

function createMockClient() {
  const single = vi.fn();
  const maybeSingle = vi.fn();
  const eqInner = vi.fn().mockReturnValue({ single, maybeSingle });
  const eq = vi.fn().mockReturnValue({ eq: eqInner, single, maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });

  const updateEq = vi.fn();
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const from = vi.fn().mockReturnValue({ select, update });

  return { from, select, eq, eqInner, single, maybeSingle, update, updateEq };
}

describe("findProviderResultByRef", () => {
  it("returns data when provider result found", async () => {
    const client = createMockClient();
    const row = {
      id: "pr-1",
      artifact_id: "a-1",
      user_id: "u-1",
      provider_status: "approved",
      updated_at: null,
    };
    client.maybeSingle.mockResolvedValue({ data: row, error: null });

    const result = await findProviderResultByRef(client as any, "ref-123");
    expect(result).toEqual(row);
    expect(client.from).toHaveBeenCalledWith("kyc_provider_results");
  });

  it("returns null when not found", async () => {
    const client = createMockClient();
    client.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await findProviderResultByRef(client as any, "ref-miss");
    expect(result).toBeNull();
  });

  it("returns null on error", async () => {
    const client = createMockClient();
    client.maybeSingle.mockResolvedValue({ data: null, error: { code: "42501" } });

    const result = await findProviderResultByRef(client as any, "ref-err");
    expect(result).toBeNull();
  });
});

describe("updateProviderResult", () => {
  it("succeeds without error", async () => {
    const client = createMockClient();
    client.updateEq.mockResolvedValue({ error: null });

    await expect(
      updateProviderResult(client as any, "pr-1", { provider_status: "completed" })
    ).resolves.not.toThrow();
    expect(client.from).toHaveBeenCalledWith("kyc_provider_results");
  });

  it("throws on error", async () => {
    const client = createMockClient();
    client.updateEq.mockResolvedValue({ error: { message: "permission denied" } });

    await expect(
      updateProviderResult(client as any, "pr-1", { provider_status: "completed" })
    ).rejects.toThrow("updateProviderResult failed: permission denied");
  });
});

describe("getArtifactStepType", () => {
  it("returns step_type when found", async () => {
    const client = createMockClient();
    client.maybeSingle.mockResolvedValue({ data: { step_type: "identity" } });

    const result = await getArtifactStepType(client as any, "art-1");
    expect(result).toBe("identity");
  });

  it("returns null when not found", async () => {
    const client = createMockClient();
    client.maybeSingle.mockResolvedValue({ data: null });

    const result = await getArtifactStepType(client as any, "art-miss");
    expect(result).toBeNull();
  });
});

describe("getVerificationStepForUserAndType", () => {
  it("returns step when found", async () => {
    const client = createMockClient();
    const step = { id: "s-1", status: "pending", risk_score: 0.3 };
    client.maybeSingle.mockResolvedValue({ data: step });

    const result = await getVerificationStepForUserAndType(client as any, "u-1", "identity");
    expect(result).toEqual(step);
  });

  it("returns null when no step exists", async () => {
    const client = createMockClient();
    client.maybeSingle.mockResolvedValue({ data: null });

    const result = await getVerificationStepForUserAndType(client as any, "u-2", "location");
    expect(result).toBeNull();
  });
});

describe("updateVerificationStepRiskDecision", () => {
  it("succeeds silently on success", async () => {
    const client = createMockClient();
    client.updateEq.mockResolvedValue({ error: null });

    await expect(
      updateVerificationStepRiskDecision(client as any, "s-1", { risk_score: 0.9 })
    ).resolves.not.toThrow();
  });

  it("throws on error", async () => {
    const client = createMockClient();
    client.updateEq.mockResolvedValue({ error: { message: "constraint violation" } });

    await expect(
      updateVerificationStepRiskDecision(client as any, "s-1", { risk_score: 0.9 })
    ).rejects.toThrow("updateVerificationStepRiskDecision failed");
  });
});
