"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";

/** An unpaid payment a checkout found open at Ozow (the billing route's
 * pendingPayment reply): continue it, check its status, or cancel it. */
export interface PendingPayment {
  id: string;
  checkoutUrl?: string | null;
  statusUrl?: string | null;
  canCancel?: boolean;
  /** An unpaid slot order or package: its number of slots and its total. */
  slots?: number;
  amountCents?: number;
  /** The unpaid order renews slots. */
  renewal?: boolean;
  /** The unpaid order is a Multi-listing package. */
  package?: boolean;
}

/** The open payment a checkout shows, and cancelling it. */
export function usePendingPayment(setError: (message: string | null) => void) {
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function cancelPending() {
    if (!pendingPayment) return;
    setCancelling(true);
    try {
      const res = await fetch("/api/billing/cancel-pending", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ paymentId: pendingPayment.id }),
      });
      if (res.ok) {
        setPendingPayment(null);
        setError(null);
      } else {
        setError("The pending payment could not be cancelled. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  return { pendingPayment, setPendingPayment, cancelling, cancelPending };
}

/** Continue payment, Check status and Cancel pending payment. */
export function PendingPaymentActions({
  pendingPayment,
  cancelling,
  onCancel,
}: {
  pendingPayment: PendingPayment;
  cancelling: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {pendingPayment.checkoutUrl ? (
        <Button asChild variant="outline" className="h-11 flex-1 rounded-full">
          <a href={pendingPayment.checkoutUrl}>Continue payment</a>
        </Button>
      ) : null}
      {pendingPayment.statusUrl ? (
        <Button asChild variant="ghost" className="h-11 flex-1 rounded-full">
          <Link href={pendingPayment.statusUrl}>Check status</Link>
        </Button>
      ) : null}
      {pendingPayment.canCancel ? (
        <Button
          variant="outline"
          className="h-11 flex-1 rounded-full"
          disabled={cancelling}
          onClick={onCancel}
        >
          {cancelling ? "Cancelling…" : "Cancel pending payment"}
        </Button>
      ) : null}
    </div>
  );
}
