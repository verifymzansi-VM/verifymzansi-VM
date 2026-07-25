"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { withCsrfHeaders } from "@/lib/utils/csrf";

/** Categories that require a secondary approver (mirrors the API route). */
const DUAL_APPROVAL_CATEGORIES: ReadonlySet<string> = new Set([
  "kyc_override",
  "account_ban",
  "data_deletion",
  "role_change",
  "policy_exception",
]);

interface DecisionActionButtonsProps {
  decisionId: string;
  actionCategory: string;
}

export function DecisionActionButtons({ decisionId, actionCategory }: DecisionActionButtonsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");
  const [secondaryApproverId, setSecondaryApproverId] = useState("");

  const requiresDualApproval = DUAL_APPROVAL_CATEGORIES.has(actionCategory);

  async function handleDecision(action: "approve" | "reject" | "escalate") {
    setError(null);

    if (!rationale.trim()) {
      setError("A rationale is required.");
      return;
    }
    if (action === "approve" && requiresDualApproval && !secondaryApproverId.trim()) {
      setError("This category requires a secondary approver ID.");
      return;
    }

    setSubmitting(action);

    try {
      const res = await fetch("/api/admin/governance/decide", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          decisionId,
          action,
          rationale: rationale.trim(),
          ...(action === "approve" && secondaryApproverId.trim()
            ? { secondaryApproverId: secondaryApproverId.trim() }
            : {}),
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
      setSubmitting(null);
    }
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
          placeholder="Explain the decision for the audit trail..."
          rows={3}
        />
      </div>

      {requiresDualApproval && (
        <div className="space-y-1.5">
          <Label htmlFor={`decision-secondary-${decisionId}`} className="text-sm font-medium">
            Secondary approver ID (required for {actionCategory})
          </Label>
          <input
            id={`decision-secondary-${decisionId}`}
            type="text"
            value={secondaryApproverId}
            onChange={(e) => setSecondaryApproverId(e.target.value)}
            placeholder="UUID of a second governance approver"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="gap-1"
          onClick={() => handleDecision("approve")}
          disabled={isPending || submitting !== null}
        >
          {submitting === "approve" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle className="h-4 w-4" />
          )}
          Approve
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="gap-1"
          onClick={() => handleDecision("reject")}
          disabled={isPending || submitting !== null}
        >
          {submitting === "reject" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          Reject
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={() => handleDecision("escalate")}
          disabled={isPending || submitting !== null}
        >
          {submitting === "escalate" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldAlert className="h-4 w-4" />
          )}
          Escalate
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
