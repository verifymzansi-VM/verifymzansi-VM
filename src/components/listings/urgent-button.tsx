"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { withCsrfHeaders } from "@/lib/utils/csrf";

interface UrgentButtonProps {
  listingId: string;
  isUrgent: boolean;
  canMarkUrgent: boolean;
  itemTypeLabel?: string;
  /** Override the API endpoint for urgent. Defaults to `/api/listings/${listingId}/urgent` */
  urgentApiPath?: string;
}

export function UrgentButton({
  listingId,
  isUrgent,
  canMarkUrgent,
  itemTypeLabel = "listing",
  urgentApiPath,
}: UrgentButtonProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  if (isUrgent) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
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
        className="h-9 w-9"
        disabled
        title={`Upgrade to Pro to mark this ${itemTypeLabel} as urgent`}
        aria-label={`Upgrade to Pro to mark this ${itemTypeLabel} as urgent`}
      >
        <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
    );
  }

  async function handleUrgent() {
    setLoading(true);
    try {
      const apiPath = urgentApiPath || `/api/listings/${listingId}/urgent`;
      const res = await fetch(apiPath, {
        method: "POST",
        headers: withCsrfHeaders(),
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
      className="h-9 w-9 transition-colors hover:text-red-500"
      onClick={handleUrgent}
      disabled={loading}
      title={`Mark this ${itemTypeLabel} as urgent (R10 for 7 days)`}
      aria-label={`Mark this ${itemTypeLabel} as urgent`}
    >
      <AlertTriangle className={`h-3.5 w-3.5 ${loading ? "animate-pulse" : ""}`} />
    </Button>
  );
}
