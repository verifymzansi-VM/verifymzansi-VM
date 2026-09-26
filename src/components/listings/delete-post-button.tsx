"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import type { MarketplaceArea } from "@/types/enums";

interface DeletePostButtonProps {
  itemId: string;
  area: MarketplaceArea;
  /** Optional label override (default: "Delete") */
  label?: string;
}

export function DeletePostButton({ itemId, area, label = "Delete" }: DeletePostButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/content/delete", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ itemId, area }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to delete");
        return;
      }

      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Delete this post?"
      >
        <Button
          variant="destructive"
          size="sm"
          className="h-11 gap-1.5 px-4"
          onClick={handleDelete}
          disabled={loading}
        >
          {loading ? (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          Yes, delete
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-11 px-3"
          onClick={() => setConfirming(false)}
          disabled={loading}
        >
          Keep it
        </Button>
        {error && (
          <p role="alert" className="inline-form-error">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-11 gap-1.5 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
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
