"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, CheckCircle, Loader2, XCircle } from "lucide-react";

interface DsarActionButtonsProps {
  requestId: string;
  status: "submitted" | "in_progress";
}

export function DsarActionButtons({ requestId, status }: DsarActionButtonsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completionNotes, setCompletionNotes] = useState("");

  async function handleDecision(decision: "approve" | "reject") {
    setError(null);
    setSubmitting(true);

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
    } finally {
      setSubmitting(false);
    }
  }

  async function handleComplete() {
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/admin/dsar/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          notes: completionNotes.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }

      startTransition(() => {
        router.refresh();
      });
      setShowCompleteDialog(false);
      setCompletionNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (isPending || submitting) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1 flex-shrink-0">
        {status === "submitted" ? (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-brand-green"
              onClick={() => handleDecision("approve")}
              title="Approve and begin processing"
              aria-label="Approve request"
            >
              <CheckCircle className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-destructive"
              onClick={() => handleDecision("reject")}
              title="Reject request"
              aria-label="Reject request"
            >
              <XCircle className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-brand-green"
            onClick={() => {
              setError(null);
              setShowCompleteDialog(true);
            }}
            title="Mark request completed"
            aria-label="Complete request"
          >
            <Check className="h-4 w-4" />
          </Button>
        )}
      </div>
      {error && <p className="text-[10px] text-destructive max-w-[120px] text-right">{error}</p>}

      <Dialog
        open={showCompleteDialog}
        onOpenChange={(open) => {
          setShowCompleteDialog(open);
          if (!open) {
            setError(null);
            setCompletionNotes("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Data Request</DialogTitle>
            <DialogDescription>
              Add an optional summary for the audit trail and requester notification before marking
              this DSAR as completed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor={`dsar-complete-notes-${requestId}`} className="text-sm font-medium">
              Completion Summary
            </Label>
            <Textarea
              id={`dsar-complete-notes-${requestId}`}
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              placeholder="Summarize what was delivered or how the request was fulfilled..."
              rows={4}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCompleteDialog(false);
                setError(null);
                setCompletionNotes("");
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleComplete} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm Completion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
