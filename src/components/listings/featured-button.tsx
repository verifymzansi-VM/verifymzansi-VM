"use client";

import { Star } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface FeaturedButtonProps {
  listingId: string;
  isFeatured: boolean;
  canFeature: boolean;
}

export function FeaturedButton({ listingId, isFeatured, canFeature }: FeaturedButtonProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  if (isFeatured) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
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
        className="h-8 w-8"
        disabled
        title="Upgrade to Pro to feature listings"
        aria-label="Upgrade to Pro to feature listings"
      >
        <Star className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
    );
  }

  async function handleFeatured() {
    setLoading(true);
    try {
      const res = await fetch(`/api/listings/${listingId}/featured`, {
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
      className="h-8 w-8 transition-colors hover:text-brand-gold"
      onClick={handleFeatured}
      disabled={loading}
      title="Feature this listing (R25 for 7 days)"
      aria-label="Feature this listing"
    >
      <Star className={`h-3.5 w-3.5 ${loading ? "animate-pulse" : ""}`} />
    </Button>
  );
}
