import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyKycProviderWebhook } from "./kyc-webhook-store";

const payload = { provider_ref: "ref-1", status: "approved" as const };
function client(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, admin: { rpc } as unknown as Pick<SupabaseClient, "rpc"> };
}

describe("applyKycProviderWebhook", () => {
  it.each(["applied", "duplicate"])("returns the committed %s outcome", async (outcome) => {
    const { admin, rpc } = client({ outcome, provider_result_id: "result-1" });
    expect(await applyKycProviderWebhook(admin, payload)).toEqual({
      outcome,
      provider_result_id: "result-1",
    });
    expect(rpc).toHaveBeenCalledWith("apply_kyc_provider_webhook", {
      p_provider_ref: "ref-1",
      p_status: "approved",
      p_scores: {},
      p_ocr_payload: null,
      p_raw_response: null,
    });
  });
  it("distinguishes a missing reference from a database failure", async () => {
    expect(await applyKycProviderWebhook(client({ outcome: "unknown" }).admin, payload)).toEqual({
      outcome: "unknown",
    });
    await expect(
      applyKycProviderWebhook(client(null, { message: "Database unavailable" }).admin, payload)
    ).rejects.toThrow("KYC callback transaction failed");
  });
  it("rejects unexpected RPC results instead of acknowledging unfinished work", async () => {
    await expect(applyKycProviderWebhook(client(null).admin, payload)).rejects.toThrow(
      "Invalid KYC callback"
    );
  });
  it("passes provider metadata to the transaction", async () => {
    const { admin, rpc } = client({ outcome: "applied", provider_result_id: "result-1" });
    await applyKycProviderWebhook(admin, {
      ...payload,
      scores: { liveness_score: 80 },
      ocr_payload: { document: "test" },
      raw_response: { decision: true },
    });
    expect(rpc).toHaveBeenCalledWith(
      "apply_kyc_provider_webhook",
      expect.objectContaining({
        p_scores: { liveness_score: 80 },
        p_ocr_payload: { document: "test" },
        p_raw_response: { decision: true },
      })
    );
  });
});
