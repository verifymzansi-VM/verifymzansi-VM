"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import type { MarketplaceArea } from "@/types/enums";

interface ResubmitButtonProps {
  itemId: string;
  area: MarketplaceArea;
  /** Optional label override (default: "Resubmit for review") */
  label?: string;
}

export function ResubmitButton({
  itemId,
  area,
  label = "Resubmit for review",
}: ResubmitButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleResubmit() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/content/resubmit", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ itemId, area }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to resubmit");
        return;
      }

      // Refresh the page to show the updated status
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        className="h-11 gap-1.5 border-brand-green-600 px-4 text-brand-green-700 hover:bg-brand-green/10 dark:border-brand-green-400 dark:text-brand-green-300"
        onClick={handleResubmit}
        disabled={loading}
      >
        {loading ? (
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        {label}
      </Button>
      {error && (
        <p role="alert" className="inline-form-error">
          {error}
        </p>
      )}
    </div>
  );
}
