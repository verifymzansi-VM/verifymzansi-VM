/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { NormalizedOzowWebhook } from "../payments/ozow";
import { providerEventKey } from "./billing-runtime";

vi.mock("server-only", () => ({}));

const notice = (change: Partial<NormalizedOzowWebhook> = {}): NormalizedOzowWebhook => ({
  eventType: "transaction.complete",
  merchantReference: "a".repeat(32),
  providerPaymentId: "request-synthetic",
  transactionId: "transaction-synthetic",
  siteCode: "SYNTHETIC-SITE",
  isTest: false,
  format: "api",
  status: "Successful",
  amount: "50.00",
  currencyCode: "ZAR",
  rawPayload: {},
  ...change,
});
const thinBytes = JSON.stringify({ type: "transaction.complete", data: { id: "t" } });

// The repeat-notice key (private.provider_events) decides which notices the
// database ignores as repeats (PAY-09).
describe("the repeat-notice key", () => {
  it("is a SHA-256 hex digest", () => {
    expect(providerEventKey(notice(), thinBytes)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is the same for an identical repeat", () => {
    expect(providerEventKey(notice(), thinBytes)).toBe(providerEventKey(notice(), thinBytes));
  });

  it.each(["Pending", "Refunded", "Error"])(
    "changes with the transaction's status (%s after Successful), for the same bytes",
    (status) => {
      expect(providerEventKey(notice({ status }), thinBytes)).not.toBe(
        providerEventKey(notice(), thinBytes)
      );
    }
  );

  it("ignores only the spelling of the status", () => {
    expect(providerEventKey(notice({ status: "successful" }), thinBytes)).toBe(
      providerEventKey(notice(), thinBytes)
    );
  });

  it("changes with the transaction, for the same bytes and status", () => {
    expect(providerEventKey(notice({ transactionId: "transaction-other" }), thinBytes)).not.toBe(
      providerEventKey(notice(), thinBytes)
    );
  });

  it("changes with the signed evidence", () => {
    expect(providerEventKey(notice(), `${thinBytes} `)).not.toBe(
      providerEventKey(notice(), thinBytes)
    );
  });
});
