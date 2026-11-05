"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";

export function LiftRestrictionButton({
  restrictionId,
  expectedVersion,
}: {
  restrictionId: string;
  expectedVersion?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function lift() {
    if (reason.trim().length < 10) {
      setError("Explain why in at least 10 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/governance/restrictions/lift", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ restrictionId, expectedVersion, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== "lifted") {
        if (data.code === "mfa_required" || data.code === "step_up_required") {
          router.push(staffVerifyHref("/staff/two-step", "/admin/governance/enforcement"));
          return;
        }
        setError(data.error ?? "The restriction could not be lifted. Reload before trying again.");
        return;
      }
      setOpen(false);
      startTransition(() => router.refresh());
    } catch {
      setError("The lift could not be confirmed. Reload before trying again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Lift
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 sm:w-72">
      <Label htmlFor={`lift-${restrictionId}`} className="text-sm">
        Why lift it?
      </Label>
      <Textarea
        id={`lift-${restrictionId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={expectedVersion === undefined ? 1000 : 500}
        rows={2}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={lift} disabled={busy} className="gap-1">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Lift restriction
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
