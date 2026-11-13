/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationServiceApi } from "./service-api";
import {
  isPaymentProblemReason,
  PAYMENT_PROBLEM_LABELS,
  PAYMENT_PROBLEM_REASONS,
  paymentAnomaly,
  recordPaymentProblem,
} from "./payment-problems";

const logged = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../utils/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), ...logged }),
}));

const PAYMENT = "00000000-0000-4000-8000-000000000003";
const rpc = vi.fn();
const service = { rpc } as unknown as FoundationServiceApi;
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: { id: PAYMENT, new: true, alert: false }, error: null });
});

describe("the reason list", () => {
  // The latest update that sets the list (the table constraint and the command).
  const update = readdirSync("database/foundation/updates")
    .filter((name) =>
      readFileSync(`database/foundation/updates/${name}`, "utf8").includes(
        "payment_problems_reason_check"
      )
    )
    .sort()
    .at(-1);
  const sql = readFileSync(`database/foundation/updates/${update}`, "utf8");

  it("is exactly the list the database accepts, in the table and in the command", () => {
    const lists = [...sql.matchAll(/(?<![a-z_.])(?:p_)?reason (?:not )?in \(([^)]*)\)/g)].map(
      (match) => [...match[1].matchAll(/'([a-z_]+)'/g)].map((reason) => reason[1])
    );
    expect(lists).toHaveLength(2);
    for (const list of lists) expect(list).toEqual([...PAYMENT_PROBLEM_REASONS]);
  });

  it("covers every code the confirmation check refuses with, except our own settings", async () => {
    const { confirmationRefusalCode, isRetryableConfirmationRefusal } =
      await import("../payments/confirmation");
    const source = readFileSync("src/lib/payments/confirmation.ts", "utf8");
    const refusals = [...source.matchAll(/return "([A-Z][^"]+)";/g)].map((match) => match[1]);
    expect(refusals.length).toBeGreaterThan(10);
    for (const refusal of refusals) {
      const code = confirmationRefusalCode(refusal);
      expect(isPaymentProblemReason(code) || isRetryableConfirmationRefusal(refusal), code).toBe(
        true
      );
    }
  });

  it("has plain words for every reason", () => {
    for (const reason of PAYMENT_PROBLEM_REASONS)
      expect(PAYMENT_PROBLEM_LABELS[reason]).toMatch(/^[A-Z][^<>]{5,}$/);
  });
});

describe("which problems email staff at once", () => {
  it.each([
    ["amount_mismatch", "Successful", "wrong_amount"],
    ["currency_mismatch", "successful", "wrong_amount"],
    // No money moved: summary only.
    ["amount_mismatch", null, null],
    ["amount_mismatch", "Error", null],
    ["currency_mismatch", "Pending", null],
    ["conflicting_transaction", null, "paid_twice"],
    ["transaction_reused", null, "paid_twice"],
    ["multiple_settlements", null, "paid_twice"],
    ["transaction_id_mismatch", "Successful", "paid_twice"],
    ["transaction_id_mismatch", "successful", "paid_twice"],
    ["transaction_id_mismatch", "Error", null],
    ["transaction_id_mismatch", null, null],
    ["complete_unfulfillable_target", null, "not_activated"],
    ["refunded_after_completion", null, "refunded"],
    ["site_code_mismatch", "Successful", null],
    ["test_mode_mismatch", null, null],
    ["unknown_payment", null, null],
    ["request_mismatch", null, null],
  ] as const)("%s (bank status %s) is %s", (reason, status, anomaly) => {
    expect(paymentAnomaly(reason, status)).toBe(anomaly);
  });
});

describe("recordPaymentProblem", () => {
  it("logs the payment number and reason and keeps an anomaly marked", async () => {
    await recordPaymentProblem(service, {
      paymentId: PAYMENT,
      reason: "amount_mismatch",
      source: "notice",
      reportedStatus: "Successful",
    });
    expect(logged.error).toHaveBeenCalledExactlyOnceWith("Payment problem", {
      paymentId: PAYMENT,
      reason: "amount_mismatch",
      source: "notice",
      anomaly: "wrong_amount",
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_payment_problem", {
      p_payment_id: PAYMENT,
      p_reason: "amount_mismatch",
      p_source: "notice",
      p_alert: true,
      p_transaction: null,
    });
  });

  it("passes the transaction, and a key within 100 characters for a long one", async () => {
    await recordPaymentProblem(service, {
      paymentId: PAYMENT,
      reason: "transaction_id_mismatch",
      source: "notice",
      reportedStatus: "Successful",
      transaction: "tx-1",
    });
    const long = Array.from({ length: 3 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
    await recordPaymentProblem(service, {
      paymentId: PAYMENT,
      reason: "multiple_settlements",
      source: "status_check",
      transaction: long.join(","),
    });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_alert: true, p_transaction: "tx-1" });
    expect(rpc.mock.calls[1][1].p_transaction).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never holds up its caller for more than three seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      rpc.mockReturnValue(new Promise(() => {}));
      let settled = false;
      const pending = recordPaymentProblem(service, {
        paymentId: PAYMENT,
        reason: "amount_mismatch",
        source: "notice",
        reportedStatus: "Successful",
      }).then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(2_900);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      await pending;
      expect(logged.error).toHaveBeenCalledWith(
        "Payment problem could not be recorded",
        expect.objectContaining({ paymentId: PAYMENT, reason: "amount_mismatch" })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks the database call to stop at the same limit when it can", async () => {
    const abortSignal = vi.fn(async () => ({ data: { new: true, alert: true }, error: null }));
    rpc.mockReturnValue({ abortSignal });
    await recordPaymentProblem(service, {
      paymentId: PAYMENT,
      reason: "site_code_mismatch",
      source: "notice",
    });
    expect(abortSignal).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
    expect(logged.error).not.toHaveBeenCalled();
  });

  it("logs a summary-only problem as a warning", async () => {
    await recordPaymentProblem(service, {
      paymentId: PAYMENT,
      reason: "site_code_mismatch",
      source: "status_check",
    });
    expect(logged.warn).toHaveBeenCalledExactlyOnceWith("Payment problem", {
      paymentId: PAYMENT,
      reason: "site_code_mismatch",
      source: "status_check",
    });
    expect(logged.error).not.toHaveBeenCalled();
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_alert: false });
  });

  it("never marks a problem without a payment, which no email could name", async () => {
    await recordPaymentProblem(service, {
      paymentId: null,
      reason: "amount_mismatch",
      source: "notice",
    });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_payment_id: null, p_alert: false });
  });

  it("only logs a reason outside the closed list", async () => {
    await recordPaymentProblem(service, {
      paymentId: PAYMENT,
      reason: "some_new_reason",
      source: "notice",
    });
    expect(logged.warn).toHaveBeenCalledWith("Payment problem", {
      paymentId: PAYMENT,
      reason: "some_new_reason",
      source: "notice",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["a database error", () => rpc.mockResolvedValue({ data: null, error: { code: "42883" } })],
    ["an unexpected answer", () => rpc.mockResolvedValue({ data: "yes", error: null })],
    ["a thrown error", () => rpc.mockRejectedValue(new Error("PRIVATE_NETWORK_DETAIL"))],
  ])("logs and swallows %s", async (_case, arrange) => {
    arrange();
    await expect(
      recordPaymentProblem(service, {
        paymentId: PAYMENT,
        reason: "multiple_settlements",
        source: "status_check",
      })
    ).resolves.toBeUndefined();
    expect(logged.error).toHaveBeenCalledWith("Payment problem could not be recorded", {
      paymentId: PAYMENT,
      reason: "multiple_settlements",
      source: "status_check",
      anomaly: "paid_twice",
    });
    expect(JSON.stringify(logged.error.mock.calls)).not.toContain("PRIVATE");
  });

  it("still logs when there is no database binding at all", async () => {
    const factory = vi.fn(() => {
      throw new Error("Foundation service binding is unavailable");
    });
    await recordPaymentProblem(factory, {
      paymentId: null,
      reason: "invalid_json",
      source: "notice",
    });
    expect(factory).toHaveBeenCalledOnce();
    expect(logged.warn).toHaveBeenCalledWith("Payment problem", {
      paymentId: null,
      reason: "invalid_json",
      source: "notice",
    });
    expect(logged.error).toHaveBeenCalledWith(
      "Payment problem could not be recorded",
      expect.objectContaining({ reason: "invalid_json" })
    );
  });
});
