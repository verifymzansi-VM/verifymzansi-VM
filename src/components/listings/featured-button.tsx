"use client";

import { Star } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface FeaturedButtonProps {
  listingId: string;
  isFeatured: boolean;
  canFeature: boolean;
  itemTypeLabel?: string;
  featuredApiPath?: string;
}

export function FeaturedButton({
  listingId,
  isFeatured,
  canFeature,
  itemTypeLabel = "listing",
  featuredApiPath,
}: FeaturedButtonProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  if (isFeatured) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        disabled
        title="Already featured"
        aria-label="Already featured"
      >
        <Star className="h-3.5 w-3.5 text-brand-gold fill-brand-gold" />
      </Button>
    );
  }

  if (!canFeature) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        disabled
        title={`Upgrade to Pro to feature this ${itemTypeLabel}`}
        aria-label={`Upgrade to Pro to feature this ${itemTypeLabel}`}
      >
        <Star className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
    );
  }

  async function handleFeatured() {
    setLoading(true);
    try {
      const apiPath = featuredApiPath || `/api/listings/${listingId}/featured`;
      const res = await fetch(apiPath, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Featured failed",
          description: data.error || "Failed to create featured checkout",
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
      className="h-9 w-9 transition-colors hover:text-brand-gold"
      onClick={handleFeatured}
      disabled={loading}
      title={`Feature this ${itemTypeLabel} (R25 for 7 days)`}
      aria-label={`Feature this ${itemTypeLabel}`}
    >
      <Star className={`h-3.5 w-3.5 ${loading ? "animate-pulse" : ""}`} />
    </Button>
  );
}
