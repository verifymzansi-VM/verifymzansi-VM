"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { RETAIL_OFFERS, formatPlanPrice } from "@/lib/constants/pricing";
import { cn } from "@/lib/utils";

/**
 * What the staff forms for an Individual slot order share (recording a bank
 * transfer, ./bank-transfer-form.tsx, and issuing an invoice,
 * ./invoice-panel.tsx): the customer's account email, checked before anything
 * is written, and the slot term and number of slots with the order total.
 * The database prices, checks and records everything again.
 */

const TERMS = [30, 90, 180] as const;
type SlotTerm = (typeof TERMS)[number];
const slotPrice = (days: number) =>
  RETAIL_OFFERS.find((offer) => offer.durationDays === days)?.priceCents ?? 0;

type Customer = {
  customer_name: string | null;
  id_reviewed: boolean;
  can_use_slots: boolean;
  slots_held: number | null;
  slot_limit: number | null;
};

/** Asks the staff route whose account the email names (records nothing). */
async function lookUpCustomer(
  email: string
): Promise<{ customer: Customer } | { error: string; redirect?: string }> {
  try {
    const res = await fetch("/api/admin/commercial", {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ action: "payment.transfer_customer", accountEmail: email }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.data) return { customer: body.data as Customer };
    if (body.code === "step_up_required" || body.code === "mfa_required")
      return {
        error: "",
        redirect: staffVerifyHref(
          "/staff/two-step",
          window.location.pathname + window.location.search
        ),
      };
    return { error: body.error ?? "The customer's account could not be checked." };
  } catch {
    return { error: "Network error. Please try again." };
  }
}

/** The term, the number of slots and the order total of a slot order. */
export function useSlotOrder() {
  const [term, setTerm] = useState<SlotTerm>(30);
  const [slots, setSlots] = useState(1);
  const totalCents = slotPrice(term) * (Number.isSafeInteger(slots) ? slots : 0);
  return { term, setTerm, slots, setSlots, totalCents };
}
type SlotOrder = ReturnType<typeof useSlotOrder>;

/**
 * Checks whose account an email names before anything is written. Returns
 * the customer (ID review accepted, account can use slots) or null, showing
 * why (`nothingDone` says that nothing was written).
 */
export function useCustomerCheck(nothingDone: string) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<string | null>(null);
  async function checkCustomer(email: string): Promise<Customer | null> {
    setChecking(true);
    setCheck(null);
    const found = await lookUpCustomer(email);
    setChecking(false);
    if ("error" in found) {
      if (found.redirect) router.push(found.redirect);
      else setCheck(found.error);
      return null;
    }
    const customer = found.customer;
    if (!customer.id_reviewed || !customer.can_use_slots) {
      setCheck(
        customer.id_reviewed
          ? `This customer's account cannot use slots now. ${nothingDone}`
          : `This customer's ID review is not accepted yet. ${nothingDone}`
      );
      return null;
    }
    return customer;
  }
  return { checking, check, checkCustomer };
}

export function CustomerEmailField() {
  return (
    <label className="block text-sm">
      <span className="font-medium">Customer&apos;s account email</span>
      <input
        name="accountEmail"
        type="email"
        required
        maxLength={254}
        autoComplete="off"
        spellCheck={false}
        className="mt-1 block w-full rounded-md border bg-background p-2"
      />
    </label>
  );
}

/** The slot term and number of slots (and any further field of the form). */
export function SlotOrderFields({
  order,
  className = "sm:grid-cols-2",
  children,
}: {
  order: SlotOrder;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("grid gap-3", className)}>
      <label className="block text-sm">
        <span className="font-medium">Slot term</span>
        <select
          name="termDays"
          value={order.term}
          onChange={(event) => order.setTerm(Number(event.target.value) as SlotTerm)}
          className="mt-1 block w-full rounded-md border bg-background p-2"
        >
          {TERMS.map((days) => (
            <option key={days} value={days}>
              {days} days · {formatPlanPrice(slotPrice(days))} per slot
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium">Number of slots</span>
        <input
          name="slots"
          type="number"
          inputMode="numeric"
          required
          min={1}
          max={25}
          value={order.slots}
          onChange={(event) => order.setSlots(Math.trunc(Number(event.target.value)))}
          className="mt-1 block w-full rounded-md border bg-background p-2"
        />
      </label>
      {children}
    </div>
  );
}
