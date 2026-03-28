"use client";

import { useState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { useToast } from "@/hooks/use-toast";

interface SubscribeButtonProps {
  planId: string;
  planName: string;
  priceCents: number;
  isPopular?: boolean;
}

export function SubscribeButton({ planId, planName, priceCents, isPopular }: SubscribeButtonProps) {
  const [loading, setLoading] = useState(false);
  const pendingRef = useRef(false);
  const { toast } = useToast();

  async function handleClick() {
    if (priceCents === 0) return; // free plan — no action
    // Guard against double-click race: ref blocks re-entry before React re-renders
    if (pendingRef.current) return;
    pendingRef.current = true;

    setLoading(true);
    try {
      const res = await fetch("/api/billing/create-checkout", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ planId }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Checkout error",
          description: data.error || "Failed to start checkout. Please try again.",
          variant: "destructive",
        });
        return;
      }

      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
      } else {
        toast({
          title: "Checkout error",
          description: "No checkout URL received.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Something went wrong",
        description: `Could not start checkout for ${planName}. Please try again.`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
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

  return (
    <Button
      size="lg"
      variant={isPopular ? "trust-verified" : "outline"}
      className={`w-full font-semibold ${isPopular ? "shadow-md" : ""}`}
      disabled={loading}
      onClick={handleClick}
    >
      {loading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Processing…
        </>
      ) : (
        `Choose ${planName}`
      )}
    </Button>
  );
}
