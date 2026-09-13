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
import { withCsrfHeaders } from "@/lib/utils/csrf";
import type { DsarCase } from "@/types/database";

interface DsarActionButtonsProps {
  requestId: string;
  status: "submitted" | "in_progress";
  requestType: DsarCase["type"];
  identityVerified: boolean;
}

export function DsarActionButtons({
  requestId,
  status,
  requestType,
  identityVerified,
}: DsarActionButtonsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completionNotes, setCompletionNotes] = useState("");
  const [showIdentityDialog, setShowIdentityDialog] = useState(false);
  const [deletionAttestation, setDeletionAttestation] = useState("");
  const busy = isPending || submitting;
  const isDeletion = requestType === "deletion";

  async function handleDecision(decision: "approve" | "reject" | "verify_identity") {
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/admin/dsar/decide", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ requestId, decision }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }

      setShowIdentityDialog(false);
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
    if (!identityVerified || (isDeletion && !deletionAttestation.trim())) return;
    setSubmitting(true);

    try {
      const res = await fetch("/api/admin/dsar/complete", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          requestId,
          notes: completionNotes.trim() || undefined,
          deletionAttestation: isDeletion ? deletionAttestation.trim() : undefined,
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
      setDeletionAttestation("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-1 flex-shrink-0">
        {!identityVerified && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setError(null);
              setShowIdentityDialog(true);
            }}
          >
            Verify identity
          </Button>
        )}
        {status === "submitted" ? (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-brand-green"
              onClick={() => handleDecision("approve")}
              title="Approve and begin processing"
              aria-label="Approve request"
              disabled={busy}
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
              disabled={busy}
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
            disabled={busy || !identityVerified}
          >
            <Check className="h-4 w-4" />
          </Button>
        )}
      </div>
      {!identityVerified && status === "in_progress" && (
        <p className="text-xs text-muted-foreground">
          Verify identity before completing this request.
        </p>
      )}
      {error && !showCompleteDialog && !showIdentityDialog && (
        <p role="alert" className="text-xs text-destructive max-w-[180px] text-right">
          {error}
        </p>
      )}

      <Dialog
        open={showIdentityDialog}
        onOpenChange={(open) => {
          if (busy) return;
          setShowIdentityDialog(open);
          setError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verify Requester Identity</DialogTitle>
            <DialogDescription>
              Confirm only after you have independently checked that the requester is the person
              whose data is requested. This records your verification in the audit trail.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setShowIdentityDialog(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => handleDecision("verify_identity")}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}I have verified the
              requester&apos;s identity
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showCompleteDialog}
        onOpenChange={(open) => {
          if (busy) return;
          setShowCompleteDialog(open);
          if (!open) {
            setError(null);
            setCompletionNotes("");
            setDeletionAttestation("");
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
              maxLength={2000}
              disabled={busy}
            />
          </div>

          {isDeletion && (
            <div className="space-y-1.5">
              <Label htmlFor={`dsar-deletion-attestation-${requestId}`}>
                Deletion Attestation (required)
              </Label>
              <p id={`dsar-deletion-help-${requestId}`} className="text-sm text-muted-foreground">
                Confirm what data you have already deleted through the manual process. Completing
                this request records your attestation; it does not delete data.
              </p>
              <Textarea
                id={`dsar-deletion-attestation-${requestId}`}
                aria-describedby={`dsar-deletion-help-${requestId}`}
                value={deletionAttestation}
                onChange={(e) => setDeletionAttestation(e.target.value)}
                required
                maxLength={2000}
                disabled={busy}
                rows={4}
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCompleteDialog(false);
                setError(null);
                setCompletionNotes("");
                setDeletionAttestation("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={handleComplete}
              disabled={busy || !identityVerified || (isDeletion && !deletionAttestation.trim())}
            >
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm Completion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
