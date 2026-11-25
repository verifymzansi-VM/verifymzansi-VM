import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import {
  RefundAmountFields,
  cancellationCredit,
  randsToCents,
  refundEndsPaidDays,
  refundExtras,
  southAfricanToday,
  type RefundRoom,
} from "./refund-amount";

const room = (overrides: Partial<RefundRoom> = {}): RefundRoom => ({
  leftCents: 41_400,
  refundedCents: 0,
  firstPurchaseAskUntil: null,
  startsAt: "2026-11-01T10:00:00+02:00",
  endsAt: "2027-04-30T10:00:00+02:00",
  ...overrides,
});

describe("randsToCents", () => {
  it.each([
    ["414", 41_400],
    ["414.5", 41_450],
    ["R 1 242,05", 124_205],
    ["0.01", 1],
  ])("reads %s", (typed, cents) => expect(randsToCents(typed)).toBe(cents));
  it.each(["", "abc", "1.234", "-5", "1e3"])("refuses %s", (typed) =>
    expect(randsToCents(typed)).toBeNull()
  );
});

describe("refundEndsPaidDays", () => {
  it("keeps the slot running only for a part refund of our failure or a billing error", () => {
    expect(refundEndsPaidDays("our_failure_after_fix_offered", 5000, 41_400)).toBe(false);
    expect(refundEndsPaidDays("billing_error", 5000, 41_400)).toBe(false);
    expect(refundEndsPaidDays("billing_error", 41_400, 41_400)).toBe(true);
    expect(refundEndsPaidDays("s14_cancellation", 5000, 41_400)).toBe(true);
  });
});

describe("refundExtras", () => {
  it("sends nothing extra for a whole refund with nothing refunded before", () => {
    expect(refundExtras({ reasonCode: "duplicate" }, room(), 41_400)).toEqual({ extras: {} });
    expect(refundExtras({ reasonCode: "billing_error", amount: "414.00" }, room(), 41_400)).toEqual(
      { extras: {} }
    );
    expect(refundExtras({ reasonCode: "billing_error" }, undefined, 41_400)).toEqual({
      extras: {},
    });
  });
  it("sends the amount of a part refund, or of what is left", () => {
    expect(refundExtras({ reasonCode: "s14_cancellation", amount: "200" }, room(), 41_400)).toEqual(
      { extras: { amountCents: 20_000 } }
    );
    expect(
      refundExtras(
        { reasonCode: "duplicate" },
        room({ leftCents: 31_400, refundedCents: 10_000 }),
        41_400
      )
    ).toEqual({ extras: { amountCents: 31_400 } });
  });
  it("sends the ask date of a first purchase, and requires it", () => {
    expect(
      refundExtras(
        { reasonCode: "first_purchase_cancelled", askedOn: "2026-11-24" },
        room(),
        41_400
      )
    ).toEqual({ extras: { amountCents: null, askedOn: "2026-11-24" } });
    expect(refundExtras({ reasonCode: "first_purchase_cancelled" }, room(), 41_400)).toHaveProperty(
      "error"
    );
  });
  it("refuses an amount that is not valid or more than is left", () => {
    expect(
      refundExtras({ reasonCode: "s14_cancellation", amount: "x" }, room(), 41_400)
    ).toHaveProperty("error");
    expect(refundExtras({ reasonCode: "s14_cancellation", amount: "500" }, room(), 41_400)).toEqual(
      { error: "At most R414 is left to refund." }
    );
  });
});

describe("cancellationCredit", () => {
  it("credits the unused whole days at the daily price, less R50", () => {
    const credit = cancellationCredit(
      { startsAt: "2026-11-01T00:00:00Z", endsAt: "2027-04-30T00:00:00Z" },
      41_400,
      Date.parse("2026-11-11T12:00:00Z")
    );
    // 180 paid days, 169 whole days left: R414 x 169 / 180 = R388.70, less R50.
    expect(credit).toEqual({
      paidDays: 180,
      daysLeft: 169,
      creditCents: 33_870,
      endsAt: "2027-04-30T00:00:00Z",
    });
    expect(
      cancellationCredit(
        { startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" },
        6900,
        Date.parse("2026-11-29T00:00:00Z")
      )?.creditCents
    ).toBe(0);
    expect(cancellationCredit({ startsAt: null, endsAt: null }, 6900)).toBeNull();
  });
});

describe("southAfricanToday", () => {
  it("is the date in South Africa", () => {
    expect(southAfricanToday(Date.parse("2026-11-24T22:30:00Z"))).toBe("2026-11-25");
  });
});

function Fields({ reasonCode, value }: { reasonCode: string; value?: Partial<RefundRoom> }) {
  const [amount, setAmount] = useState("414.00");
  return (
    <RefundAmountFields
      room={room(value)}
      reasonCode={reasonCode}
      fullCents={41_400}
      amount={amount}
      onAmount={setAmount}
    />
  );
}

describe("RefundAmountFields", () => {
  it("says whether the slot keeps running as the amount changes", () => {
    render(<Fields reasonCode="our_failure_after_fix_offered" />);
    expect(screen.getByText(/The paid days end now/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Amount to refund (rand)"), {
      target: { value: "50" },
    });
    expect(screen.getByText("Only money goes back: the slot keeps running.")).toBeInTheDocument();
  });
  it("asks the first-purchase date and fixes the amount", () => {
    render(
      <Fields
        reasonCode="first_purchase_cancelled"
        value={{ firstPurchaseAskUntil: "2026-12-02" }}
      />
    );
    expect(screen.getByLabelText(/Customer asked in writing on/)).toBeRequired();
    expect(screen.getByLabelText("Amount to refund (rand)")).toHaveAttribute("readonly");
    expect(screen.getByText(/asked by 0?2 Dec 2026/)).toBeInTheDocument();
  });
  it("suggests the cancellation credit", () => {
    render(<Fields reasonCode="s14_cancellation" />);
    expect(screen.getByText(/Unused whole days:/)).toBeInTheDocument();
  });
});
