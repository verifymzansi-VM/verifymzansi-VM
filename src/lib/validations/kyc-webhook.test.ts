import { describe, expect, it } from "vitest";
import { KycWebhookPayloadSchema } from "./kyc-webhook";
import { KycWebhookPayloadSchema as contractSchema } from "../../test/contracts/webhooks";
const payload = { provider_ref: "synthetic-ref", status: "needs_manual_review" };
describe("shared KYC payload contract", () => {
  it("runtime and contract use the same schema", () =>
    expect(contractSchema).toBe(KycWebhookPayloadSchema));
  it.each([0, 100, 0.5, null, undefined])("accepts 0–100 scores and unknown %s", (score) => {
    expect(
      KycWebhookPayloadSchema.safeParse({ ...payload, scores: { face_match_score: score } }).success
    ).toBe(true);
  });
  it.each([-0.01, 100.01, NaN, Infinity, -Infinity, "90"])("rejects invalid score %s", (score) => {
    expect(
      KycWebhookPayloadSchema.safeParse({ ...payload, scores: { liveness_score: score } }).success
    ).toBe(false);
  });
  it.each([
    {},
    { ...payload, status: "pending" },
    { ...payload, provider_ref: " " },
    { ...payload, reason: "x".repeat(1001) },
    { ...payload, scores: { invented_score: 10 } },
    { ...payload, raw_response: { value: "é".repeat(25_000) } },
  ])("rejects missing/bounded fields", (body) => {
    expect(KycWebhookPayloadSchema.safeParse(body).success).toBe(false);
  });
});
