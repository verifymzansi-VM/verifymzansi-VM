"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

interface DsarActionButtonsProps {
  requestId: string;
}

export function DsarActionButtons({ requestId }: DsarActionButtonsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleDecision(decision: "approve" | "reject") {
    setError(null);

    try {
      const res = await fetch("/api/admin/dsar/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, decision }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }

      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (isPending) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1 flex-shrink-0">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-brand-green"
          onClick={() => handleDecision("approve")}
          title="Approve &amp; begin processing"
        >
          <CheckCircle className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive"
          onClick={() => handleDecision("reject")}
          title="Reject request"
        >
          <XCircle className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="text-[10px] text-destructive max-w-[120px] text-right">{error}</p>}
    </div>
  );
}
