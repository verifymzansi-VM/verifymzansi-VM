import { describe, expect, it } from "vitest";
import {
  isTerminalPaymentStatusView,
  toPaymentStatusView,
  type PaymentStatusView,
} from "./status-view";

describe("toPaymentStatusView", () => {
  const cases: Array<{ input: string | null | undefined; expected: PaymentStatusView }> = [
    { input: "complete", expected: "complete" },
    { input: "completed", expected: "complete" }, // legacy alias
    { input: "pending", expected: "pending" },
    { input: "processing", expected: "pending" },
    { input: "failed", expected: "failed" },
    { input: "cancelled", expected: "failed" }, // legacy alias
    { input: "expired", expected: "expired" },
    { input: "refunded", expected: "missing" }, // no public view — must not map to a live status
    { input: "unknown-status", expected: "missing" },
    { input: "", expected: "missing" },
    { input: null, expected: "missing" },
    { input: undefined, expected: "missing" },
  ];

  it.each(cases)("maps $input to $expected", ({ input, expected }) => {
    expect(toPaymentStatusView(input)).toBe(expected);
  });
});

describe("isTerminalPaymentStatusView", () => {
  const cases: Array<{ input: PaymentStatusView; expected: boolean }> = [
    { input: "complete", expected: true },
    { input: "failed", expected: true },
    { input: "expired", expected: true },
    { input: "missing", expected: true },
    { input: "pending", expected: false },
  ];

  it.each(cases)("treats $input as terminal=$expected", ({ input, expected }) => {
    expect(isTerminalPaymentStatusView(input)).toBe(expected);
  });
});
