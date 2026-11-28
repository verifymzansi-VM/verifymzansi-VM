import type { EventDetails } from "@/types/tourism-details";

/**
 * Event details added in the posting fixes batch (event_details JSON): doors
 * open, refunds, where tickets are sold and how the door takes payment. One
 * source for the form, the public event page and the feed viewer.
 */

export const EVENT_REFUND_POLICIES = [
  { value: "full_until_days", label: "Full refund until __ days before" },
  { value: "only_if_cancelled", label: "Refund only if the event is cancelled" },
  { value: "no_refunds", label: "No refunds" },
] as const;

export const EVENT_TICKET_SALES = [
  { value: "online", label: "Online" },
  { value: "door", label: "At the door" },
  { value: "both", label: "Online and at the door" },
] as const;

export const EVENT_GATE_PAYMENTS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
] as const;

/** Shown (not stored) for 18+ and 21+ events, on the form and the event page. */
export const EVENT_ID_CHECK_LINE = "ID will be checked at the door";

export function eventChecksId(ageRestriction: string | null | undefined): boolean {
  return ageRestriction === "18_plus" || ageRestriction === "21_plus";
}

export function eventSellsAtDoor(ticketSales: string | null | undefined): boolean {
  return ticketSales === "door" || ticketSales === "both";
}

/** "Full refund until 7 days before", "No refunds"…; null when not set. */
export function eventRefundText(details: EventDetails): string | null {
  switch (details.refund_policy) {
    case "full_until_days": {
      const days =
        typeof details.refund_days === "number" && details.refund_days > 0
          ? Math.round(details.refund_days)
          : null;
      return days
        ? `Full refund until ${days} ${days === 1 ? "day" : "days"} before`
        : "Full refund until shortly before";
    }
    case "only_if_cancelled":
      return "Refund only if the event is cancelled";
    case "no_refunds":
      return "No refunds";
    default:
      return null;
  }
}

/** Doors open, refunds, tickets and door payment as plain label/value pairs. */
export function eventEntryFacts(details: EventDetails): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  if (details.doors_open && /^\d{2}:\d{2}$/.test(details.doors_open)) {
    facts.push({ label: "Doors open", value: details.doors_open });
  }
  const sales = EVENT_TICKET_SALES.find((item) => item.value === details.ticket_sales);
  if (sales) facts.push({ label: "Tickets sold", value: sales.label });
  if (eventSellsAtDoor(details.ticket_sales)) {
    const payments = EVENT_GATE_PAYMENTS.filter((item) =>
      details.gate_payment?.includes(item.value)
    ).map((item) => item.label);
    if (payments.length > 0) facts.push({ label: "Pay at the door", value: payments.join(", ") });
  }
  const refund = eventRefundText(details);
  if (refund) facts.push({ label: "Refunds", value: refund });
  return facts;
}
