"use client";

import { BrandShieldAlert as ShieldAlert } from "@/components/shared/brand-shield";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, Loader2, RotateCw, XCircle } from "lucide-react";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";

interface DecisionActionButtonsProps {
  decisionId: string;
  /** The proposal version on screen; approval is refused if it has changed. */
  payloadVersion: number;
  /**
   * "decide" while pending; "withdraw" for the person who proposed it;
   * "retry" for an approved decision whose execution failed.
   */
  mode?: "decide" | "withdraw" | "retry";
  /** Shown instead of the buttons when this viewer cannot decide. */
  blockedReason?: string | null;
}

type Action = "approve" | "reject" | "escalate" | "retry_execution";

export function DecisionActionButtons({
  decisionId,
  payloadVersion,
  mode = "decide",
  blockedReason = null,
}: DecisionActionButtonsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");

  async function send(action: Action) {
    setError(null);
    if (action !== "retry_execution" && !rationale.trim()) {
      setError("Write a short rationale for the audit trail.");
      return;
    }
    setSubmitting(action);
    try {
      const body =
        action === "retry_execution"
          ? { action, decisionId }
          : action === "approve"
            ? { action, decisionId, payloadVersion, rationale: rationale.trim() }
            : { action, decisionId, rationale: rationale.trim() };
      const res = await fetch("/api/admin/governance/decide", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "mfa_required" || data.code === "step_up_required") {
          router.push(
            staffVerifyHref(data.verifyUrl, `/admin/governance/escalations/${decisionId}`)
          );
          return;
        }
        throw new Error(data.error || "The decision could not be saved. Try again.");
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The decision could not be saved. Try again.");
    } finally {
      setSubmitting(null);
    }
  }

  if (blockedReason) {
    return <p className="text-sm text-muted-foreground">{blockedReason}</p>;
  }

  const busy = isPending || submitting !== null;
  const spinner = (action: Action, icon: React.ReactNode) =>
    submitting === action ? <Loader2 className="h-4 w-4 animate-spin" /> : icon;

  if (mode === "retry") {
    return (
      <div className="space-y-2">
        <p className="text-sm">
          This decision was approved but its effect could not be applied. Retrying is safe: work
          already done is not repeated.
        </p>
        <Button size="sm" className="gap-1" onClick={() => send("retry_execution")} disabled={busy}>
          {spinner("retry_execution", <RotateCw className="h-4 w-4" />)}
          Retry the update
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (mode === "withdraw") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          You proposed this, so someone else must approve or reject it. You can withdraw it.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor={`decision-rationale-${decisionId}`} className="text-sm font-medium">
            Why are you withdrawing it?
          </Label>
          <Textarea
            id={`decision-rationale-${decisionId}`}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={2}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={() => send("reject")}
          disabled={busy}
        >
          {spinner("reject", <XCircle className="h-4 w-4" />)}
          Withdraw proposal
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`decision-rationale-${decisionId}`} className="text-sm font-medium">
          Rationale
        </Label>
        <Textarea
          id={`decision-rationale-${decisionId}`}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Explain the decision for the audit trail"
          rows={3}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="gap-1" onClick={() => send("approve")} disabled={busy}>
          {spinner("approve", <CheckCircle className="h-4 w-4" />)}
          Approve and apply
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="gap-1"
          onClick={() => send("reject")}
          disabled={busy}
        >
          {spinner("reject", <XCircle className="h-4 w-4" />)}
          Reject
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={() => send("escalate")}
          disabled={busy}
        >
          {spinner("escalate", <ShieldAlert className="h-4 w-4" />)}
          Escalate
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
