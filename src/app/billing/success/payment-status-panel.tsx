"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Clock3, Loader2, XCircle } from "lucide-react";
import {
  PaymentStatusResult,
  type PaymentStatusTone,
} from "@/components/billing/payment-status-result";
import type { PaymentStatusView } from "@/lib/payments/status-view";

const PAYMENT_POLL_INTERVAL_MS = 4000;
const PAYMENT_POLL_MAX_MS = 30 * 60 * 1000;

function getCopy(status: PaymentStatusView): {
  icon: ReactNode;
  title: string;
  description: string;
  tone: PaymentStatusTone;
  nextSteps?: readonly string[];
} {
  switch (status) {
    case "complete":
      return {
        icon: <CheckCircle2 aria-hidden="true" />,
        title: "Payment confirmed",
        description: "Your payment has been confirmed and your paid features are now active.",
        tone: "success",
        nextSteps: [
          "Create or reactivate a post from your dashboard.",
          "Nothing renews automatically.",
        ],
      };
    case "pending":
      return {
        icon: <Clock3 aria-hidden="true" />,
        title: "Payment pending",
        description: "We're waiting for Ozow to confirm. Your plan activates as soon as it does.",
        tone: "pending",
      };
    case "failed":
      return {
        icon: <XCircle aria-hidden="true" />,
        title: "Payment didn't go through",
        description:
          "The payment did not complete, so no plan was activated. You can return to billing and try again.",
        tone: "error",
      };
    case "expired":
      return {
        icon: <AlertCircle aria-hidden="true" />,
        title: "Checkout expired",
        description:
          "This checkout session expired before confirmation arrived. Start a new payment from billing to continue.",
        tone: "error",
      };
    default:
      return {
        icon: <AlertCircle aria-hidden="true" />,
        title: "Payment not found",
        description:
          "We couldn't find a payment matching this link. Check billing for your plans, or contact support if you were charged.",
        tone: "neutral",
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
  const [sessionExpired, setSessionExpired] = useState(false);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(
    ["pending", "failed", "expired"].includes(initialStatus) && Boolean(paymentId)
  );
  const copy = getCopy(status);

  useEffect(() => {
    if (!paymentId || !["pending", "failed", "expired"].includes(status)) {
      return;
    }

    let isActive = true;
    let isPolling = false;
    let stopped = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const hasExpired = () => Date.now() - startedAt >= PAYMENT_POLL_MAX_MS;

    const stopPolling = () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }

      if (isActive) {
        setIsRefreshing(false);
      }
    };

    const schedulePoll = () => {
      if (!isActive || stopped) {
        return;
      }

      if (hasExpired()) {
        setPollingPaused(true);
        stopPolling();
        return;
      }

      timer = setTimeout(() => {
        void poll();
      }, PAYMENT_POLL_INTERVAL_MS);
    };

    const poll = async () => {
      if (!isActive || stopped || isPolling) return;
      isPolling = true;
      try {
        const response = await fetch(
          `/api/billing/payment-status?payment=${encodeURIComponent(paymentId)}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(15_000),
          }
        );

        if (!response.ok) {
          if (response.status === 401 || response.status === 404) {
            if (isActive && response.status === 401) setSessionExpired(true);
            if (isActive && response.status === 404) setStatus("missing");
            stopPolling();
            return;
          }
          schedulePoll();
          return;
        }

        const payload = (await response.json()) as {
          status?: PaymentStatusView;
          terminal?: boolean;
        };

        if (!isActive) {
          return;
        }
        if (!payload.status) {
          schedulePoll();
          return;
        }

        setStatus(payload.status);

        if (payload.terminal || payload.status !== "pending") {
          stopPolling();
          return;
        }

        schedulePoll();
      } catch {
        if (hasExpired()) {
          stopPolling();
          if (isActive) setPollingPaused(true);
          return;
        }
        schedulePoll();
      } finally {
        isPolling = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        void poll();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void poll();

    return () => {
      isActive = false;
      if (timer) {
        clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [paymentId, status]);

  return (
    <PaymentStatusResult
      icon={copy.icon}
      title={sessionExpired ? "Sign in to check your payment" : copy.title}
      description={
        sessionExpired
          ? "Your session expired. Sign in again to see whether your payment was confirmed."
          : pollingPaused && status === "pending"
            ? "Confirmation is taking longer than expected. Check billing again later, or contact support if you were charged."
            : copy.description
      }
      tone={copy.tone}
      nextSteps={copy.nextSteps}
      primaryAction={
        sessionExpired
          ? {
              href: `/login?returnUrl=${encodeURIComponent(`/billing/success?payment=${encodeURIComponent(paymentId ?? "")}`)}`,
              label: "Sign in",
            }
          : status === "complete" || status === "pending"
            ? { href: "/dashboard", label: "Go to dashboard" }
            : { href: "/billing", label: "Back to billing" }
      }
      secondaryAction={
        status === "complete" || status === "pending"
          ? { href: "/billing", label: "View billing" }
          : { href: "/dashboard", label: "Go to dashboard" }
      }
    >
      {status === "pending" && isRefreshing ? (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          Refreshing payment status while confirmation completes.
        </p>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">
        Status from our payment records.
        {paymentId && status !== "missing" ? (
          <>
            {" "}
            Reference: <span className="font-mono text-foreground/80">{paymentId}</span>
          </>
        ) : null}
      </p>
    </PaymentStatusResult>
  );
}
