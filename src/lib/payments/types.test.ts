import { describe, expect, it } from "vitest";
import { getPaymentMetadata, appendProviderWebhook } from "./types";
import type { MarketplaceArea, PaymentStatus } from "@/types/enums";

function makePayment(
  providerData: Record<string, unknown> | null = null
): Parameters<typeof getPaymentMetadata>[0] {
  return {
    id: "pay_1",
    user_id: "u1",
    area: "MZANSI_MARKET" as MarketplaceArea,
    amount_cents: 1000,
    status: "completed" as PaymentStatus,
    provider_data: providerData,
  };
}

describe("getPaymentMetadata", () => {
  it("returns null when provider_data is null", () => {
    expect(getPaymentMetadata(makePayment(null))).toBeNull();
  });

  it("returns null when provider_data is an array", () => {
    expect(getPaymentMetadata(makePayment([] as unknown as Record<string, unknown>))).toBeNull();
  });

  it("returns nested metadata when metadata.type exists", () => {
    const pd = { metadata: { type: "boost", extra: 1 } };
    expect(getPaymentMetadata(makePayment(pd))).toEqual({ type: "boost", extra: 1 });
  });

  it("returns top-level provider_data when type is on top level", () => {
    const pd = { type: "featured", foo: "bar" };
    expect(getPaymentMetadata(makePayment(pd))).toEqual({ type: "featured", foo: "bar" });
  });

  it("returns null when provider_data has no type anywhere", () => {
    expect(getPaymentMetadata(makePayment({ foo: "bar" }))).toBeNull();
  });

  it("returns null when metadata is a non-object", () => {
    expect(getPaymentMetadata(makePayment({ metadata: "string" }))).toBeNull();
  });
});

describe("appendProviderWebhook", () => {
  const webhook = { event: "payment.complete", ts: "2026-01-01" };

  it("appends to existing webhooks array", () => {
    const existing = { webhooks: [{ event: "old" }], other: 1 };
    const result = appendProviderWebhook(makePayment(existing), webhook);
    expect(result).toMatchObject({
      other: 1,
      webhooks: [{ event: "old" }, webhook],
    });
    expect(result?.last_webhook_at).toBeDefined();
  });

  it("creates webhooks array when none exists", () => {
    const result = appendProviderWebhook(makePayment({ data: 1 }), webhook);
    expect(result).toMatchObject({
      data: 1,
      webhooks: [webhook],
    });
  });

  it("creates new provider_data when existing is null", () => {
    const result = appendProviderWebhook(makePayment(null), webhook);
    expect(result).toMatchObject({
      webhooks: [webhook],
    });
  });

  it("handles non-array webhooks field by starting fresh", () => {
    const result = appendProviderWebhook(makePayment({ webhooks: "not-array" }), webhook);
    expect(result?.webhooks).toEqual([webhook]);
  });
});
