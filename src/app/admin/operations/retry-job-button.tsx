"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";

export function RetryJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function retry() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/ops/jobs/retry", {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ jobId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "The job could not be retried. Try again.");
      setBusy(false);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" onClick={retry} disabled={busy} className="gap-1">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Retry job
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
