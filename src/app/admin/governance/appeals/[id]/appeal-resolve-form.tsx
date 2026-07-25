"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Gavel, Loader2 } from "lucide-react";
import { withCsrfHeaders } from "@/lib/utils/csrf";

const RESOLUTION_OPTIONS = [
  { value: "upheld", label: "Uphold original decision" },
  { value: "overturned", label: "Overturn decision" },
  { value: "partially_overturned", label: "Partially overturn" },
  { value: "dismissed", label: "Dismiss appeal" },
] as const;

interface AppealResolveFormProps {
  appealId: string;
}

export function AppealResolveForm({ appealId }: AppealResolveFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("upheld");
  const [rationale, setRationale] = useState("");

  async function handleResolve() {
    setError(null);

    if (!rationale.trim()) {
      setError("A rationale is required.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/admin/governance/appeal", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          appealId,
          status,
          rationale: rationale.trim(),
        }),
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
    } finally {
      setSubmitting(false);
    }
  }

  const statusFieldId = `appeal-status-${appealId}`;
  const rationaleFieldId = `appeal-rationale-${appealId}`;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={statusFieldId} className="text-sm font-medium">
          Resolution
        </Label>
        <select
          id={statusFieldId}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
        >
          {RESOLUTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={rationaleFieldId} className="text-sm font-medium">
          Rationale
        </Label>
        <Textarea
          id={rationaleFieldId}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Explain the resolution for the audit trail..."
          rows={3}
        />
      </div>

      <Button
        size="sm"
        className="gap-1"
        onClick={handleResolve}
        disabled={isPending || submitting}
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gavel className="h-4 w-4" />}
        Resolve Appeal
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
