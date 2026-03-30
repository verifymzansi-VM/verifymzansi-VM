"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, RotateCcw, Loader2, Gavel } from "lucide-react";
import {
  REASON_CODES,
  OVERRIDE_REASON_CODES,
  DECISION_NOTE_TEMPLATES,
} from "@/lib/constants/verification";
import { withCsrfHeaders } from "@/lib/utils/csrf";

interface EvidenceStep {
  id: string;
  step_type: string;
  status: string;
  risk_level: string | null;
  risk_score: number | null;
  auto_status: string | null;
  reason_code: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

type Decision = "approved" | "rejected" | "needs_resubmission";

/** User-facing labels for decision values */
const DECISION_LABELS: Record<Decision, string> = {
  approved: "Approved",
  rejected: "Rejected",
  needs_resubmission: "Resubmit Requested",
};
export function EvidenceDecisionControls({
  step,
  onComplete,
}: {
  step: EvidenceStep;
  onComplete: () => void;
}) {
  const { toast } = useToast();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [overrideReasonCode, setOverrideReasonCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isHighRisk = step.risk_level === "high" || step.risk_level === "critical";
  const needsOverride = decision === "approved" && isHighRisk;

  async function handleSubmit() {
    if (!decision) return;

    if (decision !== "approved" && !reasonCode) {
      toast({ title: "Please select a reason code", variant: "destructive" });
      return;
    }
    if (decision !== "approved" && !reasonNote.trim()) {
      toast({
        title: "Please provide a written explanation for this decision",
        variant: "destructive",
      });
      return;
    }
    if (needsOverride && !overrideReasonCode) {
      toast({
        title: "Override reason required",
        description: "This step has high/critical risk. You must provide an override reason.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, string> = {
        stepId: step.id,
        decision,
      };
      if (reasonCode) body.reasonCode = reasonCode;
      if (reasonNote) body.reasonNote = reasonNote;
      if (overrideReasonCode) body.overrideReasonCode = overrideReasonCode;

      const res = await fetch("/api/admin/verification/decide", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Decision failed");

      toast({
        title: `Step ${DECISION_LABELS[decision]}`,
        description: `${step.step_type} has been ${DECISION_LABELS[decision].toLowerCase()}.`,
        variant: decision === "approved" ? "success" : "default",
      });

      // Reset
      setDecision(null);
      setReasonCode("");
      setReasonNote("");
      setOverrideReasonCode("");
      onComplete();
    } catch (err) {
      toast({
        title: "Decision failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-brand-blue/30 bg-brand-blue/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Gavel className="h-4 w-4 text-brand-blue" />
          Make Decision
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Resubmission warning */}
        {step.status === "needs_resubmission" && (
          <div className="rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
            This step was previously flagged for resubmission. Verify the user has corrected the
            issue before approving.
          </div>
        )}

        {/* Risk warning */}
        {isHighRisk && (
          <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            This step has <strong>{step.risk_level}</strong> risk
            {step.risk_score !== null && <> (score: {step.risk_score})</>}. Approval requires an
            override reason.
          </div>
        )}

        {/* Decision buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={decision === "approved" ? "default" : "outline"}
            onClick={() => setDecision("approved")}
            className="gap-1"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approve
          </Button>
          <Button
            size="sm"
            variant={decision === "rejected" ? "destructive" : "outline"}
            onClick={() => setDecision("rejected")}
            className="gap-1"
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject
          </Button>
          <Button
            size="sm"
            variant={decision === "needs_resubmission" ? "secondary" : "outline"}
            onClick={() => setDecision("needs_resubmission")}
            className="gap-1"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Resubmit
          </Button>
        </div>

        {/* Reason code (for reject/resubmit) */}
        {decision && decision !== "approved" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Reason Code</Label>
            <select
              title="Reason code"
              aria-label="Reason code"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
            >
              <option value="">Select reason…</option>
              {REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {code.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Override reason (for high-risk approvals) */}
        {needsOverride && (
          <div className="space-y-1.5">
            <Label className="text-xs">Override Reason (required)</Label>
            <select
              title="Override reason code"
              aria-label="Override reason code"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={overrideReasonCode}
              onChange={(e) => setOverrideReasonCode(e.target.value)}
            >
              <option value="">Select override reason…</option>
              {OVERRIDE_REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {code.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Note templates */}
        {decision && (
          <div className="space-y-1.5">
            <Label className="text-xs">
              {decision === "approved"
                ? "Note (optional — click template to fill)"
                : "Written Explanation (required — click template or type)"}
            </Label>
            <div className="flex flex-wrap gap-1">
              {DECISION_NOTE_TEMPLATES.map((template, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setReasonNote(template)}
                  className="rounded-full border border-warm-200/70 dark:border-warm-700/70 bg-warm-50 dark:bg-warm-900 px-2 py-0.5 text-[10px] hover:bg-warm-100 dark:hover:bg-warm-800"
                >
                  {template.slice(0, 45)}…
                </button>
              ))}
            </div>
            <Textarea
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              rows={2}
              placeholder={
                decision === "approved"
                  ? "Additional notes for this decision…"
                  : "Explain the issue to the user…"
              }
              className={`text-xs ${decision !== "approved" && !reasonNote.trim() ? "border-destructive" : ""}`}
            />
          </div>
        )}

        {/* Submit */}
        {decision && (
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            variant={
              decision === "approved"
                ? "default"
                : decision === "rejected"
                  ? "destructive"
                  : "secondary"
            }
            className="w-full gap-2"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Gavel className="h-4 w-4" />
            )}
            Confirm{" "}
            {decision === "approved"
              ? "Approval"
              : decision === "rejected"
                ? "Rejection"
                : "Resubmission Request"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
