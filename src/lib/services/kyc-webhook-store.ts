import type { SupabaseClient } from "@supabase/supabase-js";

type WebhookResult =
  { outcome: "unknown" } | { outcome: "applied" | "duplicate"; provider_result_id: string };

/** PostgreSQL commits callback evidence, step risk and audit under a row lock. */
export async function applyKycProviderWebhook(
  admin: Pick<SupabaseClient, "rpc">,
  payload: {
    provider_ref: string;
    status: "approved" | "rejected" | "needs_manual_review";
    scores?: Record<string, number>;
    ocr_payload?: Record<string, unknown>;
    raw_response?: Record<string, unknown>;
  }
): Promise<WebhookResult> {
  const { data, error } = await admin.rpc("apply_kyc_provider_webhook", {
    p_provider_ref: payload.provider_ref,
    p_status: payload.status,
    p_scores: payload.scores ?? {},
    p_ocr_payload: payload.ocr_payload ?? null,
    p_raw_response: payload.raw_response ?? null,
  });
  // Outages and missing migrations must trigger provider retries.
  if (error) throw new Error(`KYC callback transaction failed: ${error.message}`);
  if (data?.outcome === "unknown") return { outcome: "unknown" };
  if (
    (data?.outcome === "applied" || data?.outcome === "duplicate") &&
    typeof data.provider_result_id === "string"
  ) {
    return { outcome: data.outcome, provider_result_id: data.provider_result_id };
  }
  throw new Error("Invalid KYC callback transaction result");
}
