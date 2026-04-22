"use client";

import { useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { withCsrfHeaders } from "@/lib/utils/csrf";

type AddonCheckoutButtonProps = {
  apiPath: string;
  isActive: boolean;
  canUse: boolean;
  activeTitle: string;
  unavailableTitle: string;
  actionTitle: string;
  errorTitle: string;
  errorFallbackDescription: string;
  hoverClassName: string;
  activeIconClassName: string;
  Icon: ComponentType<{ className?: string }>;
};

export function AddonCheckoutButton({
  apiPath,
  isActive,
  canUse,
  activeTitle,
  unavailableTitle,
  actionTitle,
  errorTitle,
  errorFallbackDescription,
  hoverClassName,
  activeIconClassName,
  Icon,
}: AddonCheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  if (isActive) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        disabled
        title={activeTitle}
        aria-label={activeTitle}
      >
        <Icon className={`h-3.5 w-3.5 ${activeIconClassName}`} />
      </Button>
    );
  }

  if (!canUse) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        disabled
        title={unavailableTitle}
        aria-label={unavailableTitle}
      >
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
    );
  }

  async function handleCheckout() {
    setLoading(true);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: withCsrfHeaders(),
      });
      const data = await res.json();

      if (!res.ok) {
        toast({
          title: errorTitle,
          description: data.error || errorFallbackDescription,
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
      className={`h-9 w-9 transition-colors ${hoverClassName}`}
      onClick={handleCheckout}
      disabled={loading}
      title={actionTitle}
      aria-label={actionTitle}
    >
      <Icon className={`h-3.5 w-3.5 ${loading ? "animate-pulse" : ""}`} />
    </Button>
  );
}
