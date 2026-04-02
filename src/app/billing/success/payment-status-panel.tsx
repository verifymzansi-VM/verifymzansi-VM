"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PaymentStatusView } from "@/lib/payments/status-view";

function getCopy(status: PaymentStatusView) {
  switch (status) {
    case "complete":
      return {
        icon: <CheckCircle2 className="h-6 w-6 text-brand-green" />,
        title: "Payment Confirmed",
        description: "Your payment has been confirmed and your paid features are now active.",
      };
    case "pending":
      return {
        icon: <Clock3 className="h-6 w-6 text-brand-green" />,
        title: "Payment Pending",
        description:
          "Your redirect completed, but we are still waiting for the payment provider to confirm your payment.",
      };
    case "failed":
      return {
        icon: <XCircle className="h-6 w-6 text-destructive" />,
        title: "Payment Failed",
        description: "The payment did not complete. You can return to billing and try again.",
      };
    case "expired":
      return {
        icon: <AlertCircle className="h-6 w-6 text-destructive" />,
        title: "Payment Expired",
        description:
          "This checkout session expired before confirmation arrived. Please start a new payment.",
      };
    default:
      return {
        icon: <AlertCircle className="h-6 w-6 text-muted-foreground" />,
        title: "Payment Not Found",
        description: "We could not find a payment matching this request.",
      };
  }
}

export default function PaymentStatusPanel({
  initialStatus,
  paymentId,
}: {
  initialStatus: PaymentStatusView;
  paymentId?: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [isRefreshing, setIsRefreshing] = useState(
    initialStatus === "pending" && Boolean(paymentId)
  );
  const copy = getCopy(status);

  useEffect(() => {
    if (!paymentId || status !== "pending") {
      return;
    }

    let isActive = true;
    let attempts = 0;
    let timer: ReturnType<typeof setInterval> | undefined;

    const stopPolling = () => {
      if (timer) {
        clearInterval(timer);
      }

      if (isActive) {
        setIsRefreshing(false);
      }
    };

    const poll = async () => {
      attempts += 1;

      try {
        const response = await fetch(
          `/api/billing/payment-status?payment=${encodeURIComponent(paymentId)}`,
          {
            cache: "no-store",
          }
        );

        if (!response.ok) {
          if (response.status === 401 || response.status === 404 || attempts >= 8) {
            stopPolling();
          }
          return;
        }

        const payload = (await response.json()) as {
          status?: PaymentStatusView;
          terminal?: boolean;
        };

        if (!isActive || !payload.status) {
          return;
        }

        setStatus(payload.status);

        if (payload.terminal || payload.status !== "pending" || attempts >= 8) {
          stopPolling();
        }
      } catch {
        if (attempts >= 8) {
          stopPolling();
          if (isActive) setStatus("failed");
        }
      }
    };

    void poll();
    timer = setInterval(() => {
      void poll();
    }, 4000);

    return () => {
      isActive = false;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [paymentId, status]);

  return (
    <div className="container-page max-w-md space-y-4 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        {copy.icon}
      </div>

      <h1 className="font-display text-xl font-bold">{copy.title}</h1>

      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">{copy.description}</p>
          <p className="text-xs text-muted-foreground">
            Payment status is driven by your internal VerifyMzansi payment record, not only the
            redirect URL.
          </p>
          {status === "pending" && isRefreshing ? (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Refreshing payment status for up to 30 seconds.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button asChild className="gap-2">
          <Link href="/dashboard">
            Go to Dashboard
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/billing">View Billing</Link>
        </Button>
      </div>
    </div>
  );
}
