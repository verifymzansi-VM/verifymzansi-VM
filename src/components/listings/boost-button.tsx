"use client";

import { Zap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface BoostButtonProps {
  listingId: string;
  isBoosted: boolean;
  canBoost: boolean;
  /** Override the API endpoint for boosting. Defaults to `/api/listings/${listingId}/boost` */
  boostApiPath?: string;
}

export function BoostButton({ listingId, isBoosted, canBoost, boostApiPath }: BoostButtonProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  if (isBoosted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled
        title="Already boosted"
        aria-label="Already boosted"
      >
        <Zap className="h-3.5 w-3.5 text-brand-blue fill-brand-blue" />
      </Button>
    );
  }

  if (!canBoost) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled
        title="Upgrade to Growth or Pro to boost"
        aria-label="Upgrade to Growth or Pro to boost"
      >
        <Zap className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
    );
  }

  async function handleBoost() {
    setLoading(true);
    try {
      const apiPath = boostApiPath || `/api/listings/${listingId}/boost`;
      const res = await fetch(apiPath, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Boost failed",
          description: data.error || "Failed to create boost checkout",
          variant: "destructive",
        });
        return;
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch {
      toast({
        title: "Something went wrong",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 hover:text-brand-blue"
      onClick={handleBoost}
      disabled={loading}
      title="Boost this listing (R15 for 7 days)"
      aria-label="Boost this listing"
    >
      <Zap className={`h-3.5 w-3.5 ${loading ? "animate-pulse" : ""}`} />
    </Button>
  );
}
