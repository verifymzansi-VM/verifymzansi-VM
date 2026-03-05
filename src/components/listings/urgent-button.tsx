"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface UrgentButtonProps {
  listingId: string;
  isUrgent: boolean;
  canMarkUrgent: boolean;
}

export function UrgentButton({ listingId, isUrgent, canMarkUrgent }: UrgentButtonProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  if (isUrgent) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled
        title="Already urgent"
        aria-label="Already urgent"
      >
        <AlertTriangle className="h-3.5 w-3.5 text-red-500 fill-red-500" />
      </Button>
    );
  }

  if (!canMarkUrgent) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled
        title="Upgrade to Pro to mark listings as urgent"
        aria-label="Upgrade to Pro to mark listings as urgent"
      >
        <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
    );
  }

  async function handleUrgent() {
    setLoading(true);
    try {
      const res = await fetch(`/api/listings/${listingId}/urgent`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Urgent failed",
          description: data.error || "Failed to create urgent checkout",
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
      className="h-8 w-8 transition-colors hover:text-red-500"
      onClick={handleUrgent}
      disabled={loading}
      title="Mark as urgent (R10 for 7 days)"
      aria-label="Mark as urgent"
    >
      <AlertTriangle className={`h-3.5 w-3.5 ${loading ? "animate-pulse" : ""}`} />
    </Button>
  );
}
