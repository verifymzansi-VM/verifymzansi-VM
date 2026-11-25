"use client";

import { formatPlanPrice } from "@/lib/constants/pricing";

/**
 * The amount and first-purchase fields of the refund forms
 * (20261125110216_staff_part_refunds.sql). Shown only when the page could
 * read what is left to refund (api.get_staff_refunds_left); without it the
 * forms record whole refunds, as before. The database decides; these fields
 * only word the form and fill the request.
 */

/** What the refund forms know about the money left on a payment or slot. */
export type RefundRoom = {
  /** What is still left to refund on this payment or slot. */
  leftCents: number;
  /** Already refunded (or charged back) on the whole payment. */
  refundedCents: number;
  /** The last day the customer may ask to cancel a first purchase; set only
   * for the whole payment of an account's first purchase. */
  firstPurchaseAskUntil: string | null;
  /** The slot's paid dates (for the unused-days hint), when known. */
  startsAt: string | null;
  endsAt: string | null;
};

/** Reasons that always refund everything left (the amount is fixed). */
const WHOLE_ONLY = new Set([
  "first_purchase_cancelled",
  "duplicate",
  "renewal_cancelled_before_start",
]);
/** Reasons whose part refund leaves the slot running. */
const KEEPS_RUNNING = new Set(["our_failure_after_fix_offered", "billing_error"]);
const DAY_MS = 86_400_000;
const CANCELLATION_FEE_CENTS = 5000;

const day = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeZone: "Africa/Johannesburg",
});

/** Today in South Africa, YYYY-MM-DD. */
export function southAfricanToday(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(now);
}

/** Rands typed by staff ("414", "414.5", "R 1 242,00") in cents, or null. */
export function randsToCents(value: string): number | null {
  const plain = value
    .replace(/^\s*R\s*/i, "")
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(plain)) return null;
  const [whole, part = ""] = plain.split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}

/** Whether the refund ends the paid days (as the database decides it). */
export function refundEndsPaidDays(reasonCode: string, amountCents: number, leftCents: number) {
  return amountCents >= leftCents || !KEEPS_RUNNING.has(reasonCode);
}

/**
 * The unused whole days of a slot and the section 14 credit they suggest:
 * the price divided by its paid days, times the whole days left, less R50.
 */
export function cancellationCredit(
  room: Pick<RefundRoom, "startsAt" | "endsAt">,
  priceCents: number,
  now = Date.now()
) {
  if (!room.startsAt || !room.endsAt) return null;
  const starts = Date.parse(room.startsAt);
  const ends = Date.parse(room.endsAt);
  const paidDays = Math.round((ends - starts) / DAY_MS);
  if (!(paidDays > 0)) return null;
  const daysLeft = Math.max(
    0,
    Math.min(paidDays, Math.floor((ends - Math.max(now, starts)) / DAY_MS))
  );
  const creditCents = Math.max(
    0,
    Math.floor((priceCents * daysLeft) / paidDays) - CANCELLATION_FEE_CENTS
  );
  return { paidDays, daysLeft, creditCents, endsAt: room.endsAt };
}

/**
 * The extra request fields of a refund: none for a whole refund with nothing
 * refunded before (the earlier commands record it), else the amount in cents
 * and, for a first purchase, the day the customer asked. Null with a message
 * when the amount typed is not valid.
 */
export function refundExtras(
  values: Record<string, string>,
  room: RefundRoom | undefined,
  fullCents: number
): { extras: { amountCents?: number | null; askedOn?: string | null } } | { error: string } {
  if (!room) return { extras: {} };
  const reasonCode = values.reasonCode ?? "";
  if (reasonCode === "first_purchase_cancelled")
    return values.askedOn
      ? { extras: { amountCents: null, askedOn: values.askedOn } }
      : { error: "Enter the date the customer asked in writing to cancel." };
  if (WHOLE_ONLY.has(reasonCode) && room.leftCents === fullCents) return { extras: {} };
  const amountCents = WHOLE_ONLY.has(reasonCode)
    ? room.leftCents
    : randsToCents(values.amount ?? "");
  if (amountCents === null || amountCents < 1)
    return { error: "Enter the amount to refund in rand, for example 350 or 350.50." };
  if (amountCents > room.leftCents)
    return { error: `At most ${formatPlanPrice(room.leftCents)} is left to refund.` };
  return amountCents === fullCents && room.leftCents === fullCents
    ? { extras: {} }
    : { extras: { amountCents } };
}

/**
 * A refund form's submitted values read for the request: the extra fields
 * (refundExtras), the amount it returns and whether the slot keeps running;
 * or the message to show.
 */
export function readRefund(
  values: Record<string, string>,
  room: RefundRoom | undefined,
  fullCents: number
) {
  const part = refundExtras(values, room, fullCents);
  if ("error" in part) return part;
  const cents = part.extras.amountCents ?? room?.leftCents ?? fullCents;
  const keeps = room ? !refundEndsPaidDays(values.reasonCode ?? "", cents, room.leftCents) : false;
  return { extras: part.extras, cents, keeps };
}

/** The amount, the first-purchase date and what the refund does to the slot. */
export function RefundAmountFields({
  room,
  reasonCode,
  fullCents,
  amount,
  onAmount,
}: {
  room: RefundRoom;
  reasonCode: string;
  fullCents: number;
  amount: string;
  onAmount: (value: string) => void;
}) {
  const first = reasonCode === "first_purchase_cancelled";
  const wholeOnly = WHOLE_ONLY.has(reasonCode);
  const typed = wholeOnly ? room.leftCents : randsToCents(amount);
  const ends =
    typed !== null && reasonCode ? refundEndsPaidDays(reasonCode, typed, room.leftCents) : null;
  const credit =
    reasonCode === "s14_cancellation" || reasonCode === "breach_credit"
      ? cancellationCredit(room, fullCents)
      : null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Left to refund: {formatPlanPrice(room.leftCents)}
        {room.refundedCents > 0
          ? ` (${formatPlanPrice(room.refundedCents)} of this payment already returned)`
          : ""}
        .
      </p>
      <label className="block text-sm">
        <span className="font-medium">Amount to refund (rand)</span>
        <input
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          required={!wholeOnly}
          readOnly={wholeOnly}
          value={wholeOnly ? (room.leftCents / 100).toFixed(2) : amount}
          onChange={(event) => onAmount(event.target.value)}
          className="mt-1 block w-full rounded-md border bg-background p-2 read-only:bg-muted"
        />
      </label>
      {credit ? (
        <p className="text-sm text-muted-foreground">
          Unused whole days: {credit.daysLeft} of {credit.paidDays} (paid until{" "}
          {day.format(new Date(credit.endsAt))}). At the daily price, less the R50 fee:{" "}
          {formatPlanPrice(credit.creditCents)}. Count the days from the end of the 20 business
          days&apos; notice.
        </p>
      ) : null}
      {first ? (
        <label className="block text-sm">
          <span className="font-medium">Customer asked in writing on</span>
          <input
            type="date"
            name="askedOn"
            required
            max={southAfricanToday()}
            className="mt-1 block w-full rounded-md border bg-background p-2"
          />
          {room.firstPurchaseAskUntil ? (
            <span className="mt-1 block text-muted-foreground">
              The first purchase may be cancelled if the customer asked by{" "}
              {day.format(new Date(`${room.firstPurchaseAskUntil}T12:00:00+02:00`))} (5 business
              days after the payment was confirmed).
            </span>
          ) : null}
        </label>
      ) : null}
      {ends === null ? null : (
        <p className="text-sm font-medium">
          {ends
            ? "The paid days end now: the slot is withdrawn and its posts are hidden."
            : "Only money goes back: the slot keeps running."}
        </p>
      )}
    </div>
  );
}
