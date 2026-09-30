"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";

const MIN = 20;
const MAX = 2000;

export function AppealForm({ decisionId }: { decisionId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const tooShort = reason.trim().length < MIN;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (tooShort) return;
    setBusy(true);
    setError(null);
    try {
      await ensureCsrfTokenReady();
      const res = await fetch("/api/appeals", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ decisionId, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string" && data.error.trim()
            ? data.error
            : "Your appeal could not be sent. Try again."
        );
        setBusy(false);
        return;
      }
      router.replace("/appeals?submitted=1");
      router.refresh();
    } catch {
      // Network failure: keep the typed reason and show a readable message
      // instead of the browser's raw "Failed to fetch".
      setError("Your appeal could not be sent. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="appeal-reason">Why should this decision be reviewed?</Label>
        <Textarea
          id="appeal-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, MAX))}
          onBlur={() => setTouched(true)}
          rows={6}
          aria-describedby="appeal-reason-hint"
          aria-invalid={touched && tooShort}
        />
        <p id="appeal-reason-hint" className="text-xs text-muted-foreground">
          {touched && tooShort
            ? `Write at least ${MIN} characters.`
            : `${reason.length}/${MAX} characters`}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="gap-2">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Send appeal
      </Button>
    </form>
  );
}
