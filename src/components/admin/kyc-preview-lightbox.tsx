"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  CheckCircle,
  XCircle,
  RotateCcw,
  ImageIcon,
  FileText,
  AlertTriangle,
  ExternalLink,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

interface VerificationStep {
  id: string;
  user_id: string;
  step_type: string;
  status: string;
  created_at: string;
  seller_display_name: string | null;
  seller_verification_status: string | null;
}

interface KycPreviewLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: VerificationStep;
  artifact: Artifact;
  /** Whether to show the "View Full Evidence" link */
  evidenceDeskEnabled?: boolean;
  /** Called after approve/reject/resubmit so the queue refreshes */
  onDecisionComplete?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function KycPreviewLightbox({
  open,
  onOpenChange,
  step,
  artifact,
  evidenceDeskEnabled = false,
  onDecisionComplete,
}: KycPreviewLightboxProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  // Decision state
  const [deciding, setDeciding] = useState(false);
  const [decision, setDecision] = useState<"approved" | "rejected" | "needs_resubmission" | null>(
    null
  );
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isImage = artifact.content_type.startsWith("image/");
  const isPdf = artifact.content_type === "application/pdf";

  // Fetch decrypted blob when lightbox opens
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setZoom(1);
    setDeciding(false);
    setDecision(null);
    setReasonCode("");
    setReasonNote("");
    setDecisionError("");

    async function loadBlob() {
      try {
        const res = await fetch(`/api/admin/verification/evidence?artifactId=${artifact.id}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (!cancelled) {
          const url = URL.createObjectURL(blob);
          setBlobUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load document");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadBlob();

    return () => {
      cancelled = true;
    };
  }, [open, artifact.id]);

  // Revoke blob when lightbox closes
  useEffect(() => {
    if (!open && blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }
  }, [open, blobUrl]);

  // Security: revoke on visibility change
  useEffect(() => {
    function handleVisibility() {
      if (document.hidden && blobUrl) {
        URL.revokeObjectURL(blobUrl);
        setBlobUrl(null);
        setError("Document cleared for security. Reopen to reload.");
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [blobUrl]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  async function submitDecision() {
    if (!decision) return;

    if (decision !== "approved" && !reasonCode) {
      setDecisionError("Please select a reason code.");
      return;
    }

    setSubmitting(true);
    setDecisionError("");

    try {
      const res = await fetch("/api/admin/verification/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: step.id,
          decision,
          reasonCode: decision !== "approved" ? reasonCode : undefined,
          reasonNote: reasonNote || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit decision");
      }

      onOpenChange(false);
      onDecisionComplete?.();
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  const watermarkText = `CONFIDENTIAL — ${new Date().toISOString().slice(0, 16)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                {isImage ? (
                  <ImageIcon className="h-5 w-5 text-brand-blue" />
                ) : (
                  <FileText className="h-5 w-5 text-brand-blue" />
                )}
                Document Preview
              </DialogTitle>
              <DialogDescription className="flex items-center gap-2 mt-1">
                <span className="font-medium">
                  {step.seller_display_name || step.user_id.slice(0, 8) + "..."}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {STEP_LABELS[step.step_type] || step.step_type}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatBytes(artifact.file_size_bytes)}
                </span>
              </DialogDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                title="Zoom out"
                disabled={zoom <= 0.5}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground w-10 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                title="Zoom in"
                disabled={zoom >= 3}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Document viewer area */}
        <div
          className="flex-1 min-h-0 overflow-auto rounded-md border border-warm-200/70 bg-warm-50 evidence-protected"
          onContextMenu={handleContextMenu}
        >
          {loading && (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Decrypting and loading document…
              </span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-16">
              <AlertTriangle className="h-8 w-8 text-destructive/60" />
              <p className="mt-2 text-sm text-destructive">{error}</p>
            </div>
          )}

          {blobUrl && !loading && !error && (
            <div className="relative">
              {isImage && (
                <div className="flex items-center justify-center p-4 overflow-auto">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={blobUrl}
                    alt={`Evidence: ${step.step_type}`}
                    className={`max-w-full rounded select-none transition-transform origin-center ${
                      zoom <= 0.5
                        ? "scale-50"
                        : zoom <= 0.75
                          ? "scale-75"
                          : zoom <= 1
                            ? "scale-100"
                            : zoom <= 1.25
                              ? "scale-125"
                              : zoom <= 1.5
                                ? "scale-150"
                                : zoom <= 2
                                  ? "scale-[2]"
                                  : zoom <= 2.5
                                    ? "scale-[2.5]"
                                    : "scale-[3]"
                    }`}
                    draggable={false}
                  />
                </div>
              )}

              {isPdf && (
                <iframe
                  src={blobUrl}
                  title={`Evidence: ${step.step_type}`}
                  className="h-[60vh] w-full"
                />
              )}

              {!isImage && !isPdf && (
                <div className="flex flex-col items-center justify-center py-16">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Preview not available for {artifact.content_type}
                  </p>
                </div>
              )}

              {/* Watermark overlay */}
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                aria-hidden="true"
              >
                <span className="select-none text-3xl font-bold tracking-widest opacity-15 text-red-500 -rotate-[30deg] whitespace-nowrap [text-shadow:0_0_4px_rgba(0,0,0,0.1)]">
                  {watermarkText}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Purge warning */}
        {artifact.purge_after && (
          <div className="flex items-center gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Scheduled for purge: {new Date(artifact.purge_after).toLocaleDateString("en-ZA")}
          </div>
        )}

        {/* Decision area (inline in lightbox) */}
        {!deciding ? (
          <DialogFooter className="flex-wrap gap-2">
            {evidenceDeskEnabled && (
              <Button asChild variant="outline" size="sm" className="gap-1">
                <Link
                  href={`/admin/verification/evidence?stepId=${step.id}&userId=${step.user_id}`}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Full Evidence Desk
                </Link>
              </Button>
            )}
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              className="text-green-600 hover:text-green-700 hover:bg-green-50"
              onClick={() => {
                setDeciding(true);
                setDecision("approved");
              }}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10"
              onClick={() => {
                setDeciding(true);
                setDecision("rejected");
              }}
            >
              <XCircle className="h-4 w-4 mr-1" />
              Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
              onClick={() => {
                setDeciding(true);
                setDecision("needs_resubmission");
              }}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Resubmit
            </Button>
          </DialogFooter>
        ) : (
          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center gap-2">
              <Badge
                variant={decision === "approved" ? "default" : "destructive"}
                className="text-xs"
              >
                {decision === "approved"
                  ? "Approve"
                  : decision === "rejected"
                    ? "Reject"
                    : "Request Resubmission"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {STEP_LABELS[step.step_type] || step.step_type} for{" "}
                {step.seller_display_name || step.user_id.slice(0, 8) + "..."}
              </span>
            </div>

            {decision === "approved" ? (
              <p className="text-sm text-muted-foreground">
                This will mark the step as approved. If all 4 steps are approved, the seller will be
                verified.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="lb-reason-code" className="text-xs font-medium">
                    Reason Code <span className="text-destructive">*</span>
                  </Label>
                  <select
                    id="lb-reason-code"
                    title="Reason code"
                    value={reasonCode}
                    onChange={(e) => setReasonCode(e.target.value)}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
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
                  <Label htmlFor="lb-reason-note" className="text-xs font-medium">
                    Notes
                  </Label>
                  <Textarea
                    id="lb-reason-note"
                    value={reasonNote}
                    onChange={(e) => setReasonNote(e.target.value)}
                    placeholder="Optional context..."
                    rows={2}
                    className="mt-1"
                  />
                </div>
              </div>
            )}

            {decisionError && <p className="text-sm text-destructive">{decisionError}</p>}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDeciding(false);
                  setDecision(null);
                  setReasonCode("");
                  setReasonNote("");
                  setDecisionError("");
                }}
                disabled={submitting}
              >
                Back
              </Button>
              <Button
                size="sm"
                variant={decision === "approved" ? "default" : "destructive"}
                onClick={submitDecision}
                disabled={submitting}
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                {decision === "approved"
                  ? "Confirm Approve"
                  : decision === "rejected"
                    ? "Confirm Reject"
                    : "Request Resubmission"}
              </Button>
            </div>
          </div>
        )}

        {/* Security / print protection */}
        <p className="text-[10px] text-muted-foreground">
          Decrypted server-side, displayed in-memory only. Do not screenshot or download.
        </p>
        <style>{`
          @media print {
            .evidence-protected {
              display: none !important;
            }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}
