"use client";

import { useState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { MarketplaceArea, PlanTier } from "@/types/enums";

interface SubscribeButtonProps {
  area: MarketplaceArea;
  tier: PlanTier;
  priceCents: number;
  isPopular?: boolean;
}

export function SubscribeButton({ area, tier, priceCents, isPopular }: SubscribeButtonProps) {
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
      const supabase = createClient();
      const { data: dbPlan } = await supabase
        .from("plans")
        .select("id")
        .eq("area", area)
        .eq("tier", tier)
        .eq("active", true)
        .single();

      if (!dbPlan) {
        toast({
          title: "Plan not found",
          description: "This plan is not currently available. Please try again later.",
          variant: "destructive",
        });
        return;
      }

      const res = await fetch("/api/billing/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: dbPlan.id, area }),
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
        window.location.href = data.checkoutUrl;
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
        description: "Could not connect to payment service. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      pendingRef.current = false;
    }
  }

  const label = priceCents === 0 ? "Current Plan" : `Choose ${tier}`;

  return (
    <Button
      size="lg"
      variant={isPopular ? "trust-verified" : "outline"}
      className={`w-full font-semibold ${isPopular ? "shadow-md" : ""}`}
      disabled={loading || priceCents === 0}
      onClick={handleClick}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Processing...
        </>
      ) : (
        label
      )}
    </Button>
  );
}
