"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Gavel, Loader2 } from "lucide-react";
import { withCsrfHeaders } from "@/lib/utils/csrf";

const RESOLUTION_OPTIONS = [
  { value: "upheld", label: "Uphold the decision", effect: "Nothing changes." },
  {
    value: "overturned",
    label: "Overturn the decision",
    effect:
      "Lifts this decision's restrictions and restores the content it hid. Other restrictions on the account stay.",
  },
  {
    value: "partially_overturned",
    label: "Shorten the suspension",
    effect: "The suspension ends on the date you choose.",
  },
  { value: "dismissed", label: "Dismiss the appeal", effect: "Nothing changes." },
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
  const [endDate, setEndDate] = useState("");
  const selected = RESOLUTION_OPTIONS.find((option) => option.value === status);

  async function handleResolve() {
    setError(null);

    if (rationale.trim().length < 10) {
      setError("Explain the resolution in at least 10 characters.");
      return;
    }
    if (status === "partially_overturned" && !endDate) {
      setError("Choose the date the suspension should end.");
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
          // End of the chosen day, South African time.
          ...(status === "partially_overturned" ? { shortenTo: `${endDate}T23:59:00+02:00` } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "The appeal could not be resolved. Try again.");
      }

      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The appeal could not be resolved. Try again.");
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

      {selected && <p className="text-xs text-muted-foreground">{selected.effect}</p>}

      {status === "partially_overturned" && (
        <div className="space-y-1.5">
          <Label htmlFor={`appeal-end-${appealId}`} className="text-sm font-medium">
            New end date
          </Label>
          <input
            id={`appeal-end-${appealId}`}
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
          />
        </div>
      )}

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
        Resolve appeal
      </Button>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
