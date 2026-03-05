"use client";

import { useState, useCallback } from "react";
import { formatRelativeTime } from "@/lib/utils/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  CheckCircle,
  XCircle,
  RotateCcw,
  FileCheck,
  User,
  Phone,
  Camera,
  MapPin,
  CreditCard,
  Loader2,
  Eye,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { KycInlinePreview } from "./kyc-inline-preview";

const KycPreviewLightbox = dynamic(
  () => import("./kyc-preview-lightbox").then((m) => m.KycPreviewLightbox),
  {
    loading: () => (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    ),
  }
);

interface VerificationStep {
  id: string;
  user_id: string;
  step_type: string;
  status: string;
  created_at: string;
  seller_display_name: string | null;
  seller_verification_status: string | null;
}

interface Artifact {
  id: string;
  step_type: string;
  artifact_kind: string;
  r2_key: string;
  content_type: string;
  file_size_bytes: number;
  status: string;
  created_at: string;
  purge_after: string | null;
  sha256: string | null;
}

interface KycQueueTableProps {
  steps: VerificationStep[];
  onDecisionComplete?: () => void;
  evidenceDeskEnabled?: boolean;
}

const STEP_ICONS: Record<string, React.ElementType> = {
  phone: Phone,
  id_doc: CreditCard,
  selfie: Camera,
  location: MapPin,
};

const STEP_LABELS: Record<string, string> = {
  phone: "Phone Verification",
  id_doc: "ID Document",
  selfie: "Selfie Verification",
  location: "Location Proof",
};

const REASON_CODES = [
  { value: "blurry_image", label: "Image too blurry to verify" },
  { value: "mismatch", label: "Selfie does not match ID photo" },
  { value: "expired_document", label: "ID document is expired" },
  { value: "incomplete_info", label: "Missing or unreadable fields" },
  { value: "fraudulent", label: "Suspected fraudulent document" },
  { value: "wrong_document_type", label: "Uploaded wrong document type" },
  { value: "not_sa_document", label: "Document is not South African" },
  { value: "other", label: "Other (provide note)" },
];

export function KycQueueTable({
  steps,
  onDecisionComplete,
  evidenceDeskEnabled = false,
}: KycQueueTableProps) {
  const [selectedStep, setSelectedStep] = useState<VerificationStep | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected" | "needs_resubmission" | null>(
    null
  );
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Lightbox state for inline document preview
  const [lightboxStep, setLightboxStep] = useState<VerificationStep | null>(null);
  const [lightboxArtifact, setLightboxArtifact] = useState<Artifact | null>(null);

  const handlePreviewClick = useCallback((step: VerificationStep, artifact: Artifact) => {
    setLightboxStep(step);
    setLightboxArtifact(artifact);
  }, []);

  if (!steps.length) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <FileCheck className="h-8 w-8 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No pending verification steps.</p>
      </div>
    );
  }

  function openReview(step: VerificationStep, d: "approved" | "rejected" | "needs_resubmission") {
    setSelectedStep(step);
    setDecision(d);
    setReasonCode("");
    setReasonNote("");
    setError("");
  }

  function closeDialog() {
    setSelectedStep(null);
    setDecision(null);
    setReasonCode("");
    setReasonNote("");
    setError("");
  }

  async function submitDecision() {
    if (!selectedStep || !decision) return;

    if (decision !== "approved" && !reasonCode) {
      setError("Please select a reason code.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/verification/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: selectedStep.id,
          decision,
          reasonCode: decision !== "approved" ? reasonCode : undefined,
          reasonNote: reasonNote || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit decision");
      }

      closeDialog();
      onDecisionComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="space-y-3">
        {steps.map((step) => {
          const StepIcon = STEP_ICONS[step.step_type] || FileCheck;
          const stepLabel = STEP_LABELS[step.step_type] || step.step_type;

          return (
            <Card key={step.id}>
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  {/* Inline document thumbnail */}
                  <KycInlinePreview
                    stepId={step.id}
                    userId={step.user_id}
                    stepType={step.step_type}
                    onClickPreview={(artifact) => handlePreviewClick(step, artifact)}
                  />
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                    <StepIcon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">
                        {step.seller_display_name || (
                          <span className="text-muted-foreground">
                            <User className="h-3 w-3 inline mr-1" />
                            {step.user_id.slice(0, 8)}...
                          </span>
                        )}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {stepLabel}
                      </Badge>
                      <Badge
                        variant={step.status === "pending" ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {step.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Submitted {formatRelativeTime(step.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {evidenceDeskEnabled && (
                      <Button
                        asChild
                        size="sm"
                        variant="ghost"
                        className="h-8 text-brand-blue hover:text-brand-blue/80 hover:bg-brand-blue/10"
                        title="View Evidence"
                      >
                        <Link
                          href={`/admin/verification/evidence?stepId=${step.id}&userId=${step.user_id}`}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          <span className="hidden sm:inline text-xs">Evidence</span>
                        </Link>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                      onClick={() => openReview(step, "approved")}
                      title="Approve"
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline text-xs">Approve</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-destructive hover:bg-destructive/10"
                      onClick={() => openReview(step, "rejected")}
                      title="Reject"
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline text-xs">Reject</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950"
                      onClick={() => openReview(step, "needs_resubmission")}
                      title="Resubmit"
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline text-xs">Resubmit</span>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Review Decision Dialog */}
      <Dialog open={!!selectedStep} onOpenChange={(open: boolean) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision === "approved"
                ? "Approve Verification Step"
                : decision === "rejected"
                  ? "Reject Verification Step"
                  : "Request Resubmission"}
            </DialogTitle>
            <DialogDescription>
              {selectedStep && (
                <>
                  Reviewing{" "}
                  <strong>{STEP_LABELS[selectedStep.step_type] || selectedStep.step_type}</strong>{" "}
                  for{" "}
                  <strong>
                    {selectedStep.seller_display_name || selectedStep.user_id.slice(0, 8) + "..."}
                  </strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {decision === "approved" ? (
            <p className="text-sm text-muted-foreground">
              This will mark the step as approved. If all 4 verification steps are now approved, the
              seller will be marked as verified.
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="reason-code" className="text-sm font-medium">
                  Reason Code <span className="text-destructive">*</span>
                </Label>
                <select
                  id="reason-code"
                  title="Reason code"
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select a reason...</option>
                  {REASON_CODES.map((rc) => (
                    <option key={rc.value} value={rc.value}>
                      {rc.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="reason-note" className="text-sm font-medium">
                  Additional Notes
                </Label>
                <Textarea
                  id="reason-note"
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                  placeholder="Optional: provide additional context..."
                  rows={3}
                  className="mt-1.5"
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={submitDecision}
              disabled={loading}
              variant={decision === "approved" ? "default" : "destructive"}
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {decision === "approved"
                ? "Confirm Approve"
                : decision === "rejected"
                  ? "Confirm Reject"
                  : "Request Resubmission"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document Preview Lightbox */}
      {lightboxStep && lightboxArtifact && (
        <KycPreviewLightbox
          open={!!lightboxStep}
          onOpenChange={(open) => {
            if (!open) {
              setLightboxStep(null);
              setLightboxArtifact(null);
            }
          }}
          step={lightboxStep}
          artifact={lightboxArtifact}
          evidenceDeskEnabled={evidenceDeskEnabled}
          onDecisionComplete={onDecisionComplete}
        />
      )}
    </>
  );
}
