"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { useToast } from "@/hooks/use-toast";
import { getFriendlyCheckoutError } from "@/lib/billing/checkout-copy";

interface SubscribeButtonProps {
  planId: string;
  planName: string;
  priceCents: number;
  isPopular?: boolean;
}

export function SubscribeButton({ planId, planName, priceCents, isPopular }: SubscribeButtonProps) {
  const [checkoutState, setCheckoutState] = useState<"idle" | "submitting" | "redirecting">("idle");
  const [inlineMessage, setInlineMessage] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const requestControllerRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      requestControllerRef.current?.abort();
    };
  }, []);

  async function handleClick() {
    if (priceCents === 0) return; // free plan — no action
    // Guard against double-click race: ref blocks re-entry before React re-renders
    if (pendingRef.current) return;
    pendingRef.current = true;

    setInlineMessage("Opening secure Ozow checkout…");
    setCheckoutState("submitting");
    let redirectStarted = false;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      const res = await fetch("/api/billing/create-checkout", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ planId }),
        signal: controller.signal,
      });

      const data = await res.json();

      if (!res.ok) {
        const message = getFriendlyCheckoutError(res.status, data.error, planName);
        if (mountedRef.current) {
          setCheckoutState("idle");
          setInlineMessage(message);
        }
        toast({
          title: "Checkout error",
          description: message,
          variant: "destructive",
        });
        return;
      }

      if (data.checkoutUrl) {
        redirectStarted = true;
        if (mountedRef.current) {
          setCheckoutState("redirecting");
          setInlineMessage("Redirecting you to secure Ozow checkout…");
        }
        window.location.assign(data.checkoutUrl);
      } else {
        if (mountedRef.current) {
          setCheckoutState("idle");
          setInlineMessage("Secure checkout did not return a redirect URL.");
        }
        toast({
          title: "Checkout error",
          description: "Secure checkout did not return a redirect URL.",
          variant: "destructive",
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      if (mountedRef.current) {
        setCheckoutState("idle");
        setInlineMessage(`Could not start secure checkout for ${planName}. Please try again.`);
      }
      toast({
        title: "Something went wrong",
        description: `Could not start checkout for ${planName}. Please try again.`,
        variant: "destructive",
      });
    } finally {
      requestControllerRef.current = null;
      if (mountedRef.current) {
        if (!redirectStarted) {
          setCheckoutState("idle");
        }
      }
      pendingRef.current = false;
    }
  }

  if (priceCents === 0) {
    return (
      <div className="flex h-11 w-full items-center justify-center rounded-md border border-border bg-muted/40 px-4 text-sm font-medium text-muted-foreground">
        Included with your free plan
      </div>
    );
  }

  const isBusy = checkoutState === "submitting" || checkoutState === "redirecting";

  return (
    <div className="space-y-2">
      <Button
        size="lg"
        variant={isPopular ? "trust-verified" : "outline"}
        className={`w-full font-semibold ${isPopular ? "shadow-md" : ""}`}
        disabled={isBusy}
        onClick={handleClick}
      >
        {isBusy ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {checkoutState === "redirecting" ? "Redirecting…" : "Connecting to Ozow…"}
          </>
        ) : (
          `Choose ${planName}`
        )}
      </Button>
      <p
        aria-live="polite"
        className={`min-h-[1.25rem] text-xs ${
          inlineMessage?.toLowerCase().includes("could not") ||
          inlineMessage?.toLowerCase().includes("sign in") ||
          inlineMessage?.toLowerCase().includes("unavailable")
            ? "text-destructive"
            : "text-muted-foreground"
        }`}
      >
        {inlineMessage ?? "Secure Ozow checkout opens after you confirm this plan."}
      </p>
    </div>
  );
}
