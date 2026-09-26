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
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
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
        className="h-11 w-11 rounded-full"
        disabled
        title={activeTitle}
        aria-label={activeTitle}
      >
        <Icon aria-hidden="true" className={`h-4 w-4 ${activeIconClassName}`} />
      </Button>
    );
  }

  if (!canUse) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11 rounded-full"
        disabled
        title={unavailableTitle}
        aria-label={unavailableTitle}
      >
        <Icon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
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
      className={`h-11 w-11 rounded-full transition-colors ${hoverClassName}`}
      onClick={handleCheckout}
      disabled={loading}
      title={actionTitle}
      aria-label={actionTitle}
    >
      <Icon
        aria-hidden="true"
        className={`h-4 w-4 ${loading ? "animate-pulse motion-reduce:animate-none" : ""}`}
      />
    </Button>
  );
}
