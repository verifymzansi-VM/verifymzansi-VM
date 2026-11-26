import { describe, expect, it } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { previewLostDays } from "./lost-days";
import { readStaffRefundsLeft } from "./staff-payments";

// The website is deployed before 20261125194727_part_refund_follow_ups.sql is
// applied (website-first): both staff reads must accept the result shapes
// before and after the update.

const answering = (data: unknown) =>
  ({
    rpc: async () => ({ data, error: null }),
  }) as unknown as FoundationAuthenticatedApi;

const payment = "22222222-2222-4222-8222-222222222222";
const line = "33333333-3333-4333-8333-333333333333";
const before = {
  payment_id: payment,
  refunded_cents: 0,
  left_cents: 41_400,
  ozow_refund_until: null,
  first_purchase: false,
  first_purchase_ask_until: null,
  lines: [
    {
      line_id: line,
      left_cents: 41_400,
      starts_at: "2026-11-01T10:00:00+02:00",
      ends_at: "2027-04-30T10:00:00+02:00",
    },
  ],
};
const after = {
  ...before,
  left_cents: 0,
  notice_ends_on: "2026-12-23",
  lines: [{ ...before.lines[0], paid_days: 180, lost_days: 3 }],
};

describe("api.get_staff_refunds_left, before and after the follow-ups update", () => {
  it("reads the shape before the update", async () => {
    const [item] = await readStaffRefundsLeft(answering([before]), [payment]);
    expect(item.notice_ends_on).toBeUndefined();
    expect(item.lines[0].paid_days).toBeUndefined();
  });
  it("reads the shape after the update", async () => {
    const [item] = await readStaffRefundsLeft(answering([after]), [payment]);
    expect(item.notice_ends_on).toBe("2026-12-23");
    expect(item.lines[0]).toMatchObject({ paid_days: 180, lost_days: 3 });
  });
  it("still refuses fields it does not know", async () => {
    await expect(
      readStaffRefundsLeft(answering([{ ...after, surprise: 1 }]), [payment])
    ).rejects.toThrow();
  });
});

describe("api.get_lost_days_preview, before and after the follow-ups update", () => {
  const term = {
    kind: "individual",
    id: line,
    slots: 1,
    renewals: 0,
    ends_at: "2027-04-30T08:00:00+00:00",
  };
  it("reads the shape before the update", async () => {
    const { items } = await previewLostDays(answering({ items: [term] }), "m@example.test");
    expect(items[0]).not.toHaveProperty("refundedCents");
  });
  it("reads the shape after the update", async () => {
    const { items } = await previewLostDays(
      answering({
        items: [
          { ...term, refunded_cents: 2500 },
          { ...term, refunded_cents: 0 },
        ],
      }),
      "m@example.test"
    );
    expect(items[0].refundedCents).toBe(2500);
    expect(items[1]).not.toHaveProperty("refundedCents");
  });
});
