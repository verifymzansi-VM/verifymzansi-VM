"use client";

import { useEffect, useRef } from "react";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { getFriendlyCheckoutError } from "@/lib/billing/checkout-copy";
import type { PendingPayment } from "@/components/billing/pending-payment-actions";

/** What starting a checkout gave: Ozow's page to open, or why not. */
export type CheckoutStart =
  | { kind: "redirect"; url: string }
  | { kind: "refused"; message: string; signIn: boolean; pendingPayment?: PendingPayment };

/**
 * Sends a checkout order to one of the billing routes and reads its answer:
 * the redirect to Ozow, or the refusal in the member's words (`subject` names
 * what is bought, for example "your slots"), with an open payment the member
 * can continue, check or cancel.
 */
export async function postCheckoutOrder(
  url: string,
  order: Record<string, unknown>,
  subject: string
): Promise<CheckoutStart> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(order),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && typeof data.checkoutUrl === "string")
      return { kind: "redirect", url: data.checkoutUrl };
    if (res.ok)
      return {
        kind: "refused",
        message: "Secure checkout did not return a redirect URL.",
        signIn: false,
      };
    const open = data.pendingPayment;
    return {
      kind: "refused",
      message: getFriendlyCheckoutError(res.status, data.error, subject),
      signIn: res.status === 401,
      ...(open && typeof open.id === "string" && { pendingPayment: open as PendingPayment }),
    };
  } catch {
    return {
      kind: "refused",
      message: getFriendlyCheckoutError(undefined, null, subject),
      signIn: false,
    };
  }
}

/**
 * Back from Ozow through the browser's back/forward cache, the page is shown
 * again as it was left ("Redirecting…"): `reset` puts it back to idle.
 */
export function useBackForwardReset(reset: () => void) {
  const latest = useRef(reset);
  useEffect(() => {
    latest.current = reset;
  });
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) latest.current();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
}
