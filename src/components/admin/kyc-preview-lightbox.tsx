"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
import { getKycEvidenceErrorMessage } from "./kyc-evidence-errors";
import {
  getCachedKycArtifactBlob,
  setCachedKycArtifactBlob,
} from "@/lib/utils/kyc-artifact-blob-cache";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { getKycZoomWidthClass, KYC_REVIEW_REASON_CODES } from "./kyc-review-constants";

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
  account_display_name?: string | null;
  account_verification_status?: string | null;
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
  const [visibilityReloadToken, setVisibilityReloadToken] = useState(0);
  const [zoom, setZoom] = useState(1);
  const mousePanRef = useRef<{
    element: HTMLDivElement;
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const imageViewportRef = useRef<HTMLDivElement | null>(null);

  // Decision state
  const [deciding, setDeciding] = useState(false);
  const [decision, setDecision] = useState<"approved" | "rejected" | "needs_resubmission" | null>(
    null
  );
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const displayName = step.account_display_name || step.user_id.slice(0, 8) + "...";

  const isImage = artifact.content_type.startsWith("image/");
  const isPdf = artifact.content_type === "application/pdf";

  // Fetch decrypted blob when lightbox opens
  useEffect(() => {
    if (!open || document.hidden) return;

    let cancelled = false;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      setZoom(1);
      setDeciding(false);
      setDecision(null);
      setReasonCode("");
      setReasonNote("");
      setDecisionError("");
    });

    async function loadBlob() {
      try {
        const cachedBlob = getCachedKycArtifactBlob(artifact.id);
        if (cachedBlob) {
          if (!cancelled) {
            const cachedUrl = URL.createObjectURL(cachedBlob);
            setBlobUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return cachedUrl;
            });
          }
          return;
        }

        const fetchEvidenceById = async (targetArtifactId: string) => {
          const res = await fetch(`/api/admin/verification/evidence`, {
            method: "POST",
            headers: withCsrfHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ artifactId: targetArtifactId }),
            signal: controller.signal,
          });

          if (res.ok) {
            const blob = await res.blob();
            setCachedKycArtifactBlob(targetArtifactId, blob);
            return {
              ok: true as const,
              blob,
            };
          }

          const data = await res.json().catch(() => ({}));
          return {
            ok: false as const,
            code: data.code as string | undefined,
            message: getKycEvidenceErrorMessage(data.code, data.error || `HTTP ${res.status}`),
          };
        };

        let evidenceResult = await fetchEvidenceById(artifact.id);

        if (!evidenceResult.ok && evidenceResult.code === "not_found") {
          const retryMetaRes = await fetch(`/api/admin/verification/evidence/metadata`, {
            method: "POST",
            headers: withCsrfHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ userId: step.user_id }),
            signal: controller.signal,
          });

          if (retryMetaRes.ok) {
            const retryMeta = await retryMetaRes.json();
            const retryArtifacts: Artifact[] = retryMeta.artifacts || [];
            const replacement = retryArtifacts
              .filter((candidate: Artifact) => candidate.step_type === artifact.step_type)
              .sort(
                (a: Artifact, b: Artifact) =>
                  new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
              )[0];

            if (replacement && replacement.id !== artifact.id) {
              const replacementCachedBlob = getCachedKycArtifactBlob(replacement.id);
              if (replacementCachedBlob) {
                evidenceResult = {
                  ok: true as const,
                  blob: replacementCachedBlob,
                };
              } else {
                evidenceResult = await fetchEvidenceById(replacement.id);
              }
            }
          }
        }

        if (!evidenceResult.ok) {
          throw new Error(evidenceResult.message || "Failed to load document");
        }

        const blob = evidenceResult.blob;
        if (!cancelled) {
          const url = URL.createObjectURL(blob);
          setBlobUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        }
      } catch (err) {
        if (!cancelled && !controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load document");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadBlob();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, artifact.id, artifact.step_type, step.user_id, visibilityReloadToken]);

  // Revoke blob when lightbox closes
  useEffect(() => {
    if (!open && blobUrl) {
      queueMicrotask(() => {
        URL.revokeObjectURL(blobUrl);
        setBlobUrl(null);
      });
    }
  }, [open, blobUrl]);

  // Clear the visible URL while backgrounded, then reload automatically when
  // the reviewer returns. Cached blobs make this immediate in the common case.
  useEffect(() => {
    function handleVisibility() {
      if (document.hidden && blobUrl) {
        URL.revokeObjectURL(blobUrl);
        setBlobUrl(null);
        setError(null);
      } else if (!document.hidden && open) {
        setVisibilityReloadToken((token) => token + 1);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [blobUrl, open]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleZoomChange = useCallback((targetZoom: number) => {
    const boundedZoom = Math.min(3, Math.max(0.5, targetZoom));
    setZoom(boundedZoom);

    if (boundedZoom <= 1 && imageViewportRef.current) {
      imageViewportRef.current.scrollLeft = 0;
      imageViewportRef.current.scrollTop = 0;
    }
  }, []);

  const handleImageMouseDown = useCallback(
    (zoomLevel: number, e: ReactMouseEvent<HTMLDivElement>) => {
      if (zoomLevel <= 1) {
        return;
      }

      const element = e.currentTarget;
      mousePanRef.current = {
        element,
        x: e.clientX,
        y: e.clientY,
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
      };
    },
    []
  );

  const handleImageMouseMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!mousePanRef.current) {
      return;
    }

    mousePanRef.current.element.scrollLeft =
      mousePanRef.current.scrollLeft - (e.clientX - mousePanRef.current.x);
    mousePanRef.current.element.scrollTop =
      mousePanRef.current.scrollTop - (e.clientY - mousePanRef.current.y);
  }, []);

  const handleImageMouseUp = useCallback(() => {
    mousePanRef.current = null;
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
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
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
      <DialogContent className="max-w-4xl max-sm:max-w-[calc(100vw-1rem)] max-h-[90vh] flex flex-col">
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
                <span className="font-medium">{displayName}</span>
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
                onClick={() => handleZoomChange(zoom - 0.25)}
                title="Zoom out"
                aria-label="Zoom out"
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
                onClick={() => handleZoomChange(zoom + 0.25)}
                title="Zoom in"
                aria-label="Zoom in"
                disabled={zoom >= 3}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => handleZoomChange(1)}
                title="Reset zoom"
                aria-label="Reset zoom"
                disabled={zoom === 1}
              >
                Reset
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Document viewer area */}
        <div
          className="flex-1 min-h-0 overflow-auto rounded-md border border-warm-200/70 dark:border-warm-700/70 bg-warm-50 dark:bg-warm-900 evidence-protected"
          onContextMenu={handleContextMenu}
          role="presentation"
        >
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Decrypting and loading document…
              </span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-6">
              <AlertTriangle className="h-8 w-8 text-destructive/60" />
              <p className="mt-2 text-sm text-destructive">{error}</p>
            </div>
          )}

          {blobUrl && !loading && !error && (
            <div className="relative">
              {isImage && (
                <div
                  className={`min-h-[60vh] overflow-auto p-4 ${
                    zoom > 1 ? "cursor-grab active:cursor-grabbing" : ""
                  }`}
                  ref={imageViewportRef}
                  onMouseDown={(e) => handleImageMouseDown(zoom, e)}
                  onMouseMove={handleImageMouseMove}
                  onMouseUp={handleImageMouseUp}
                  onMouseLeave={handleImageMouseUp}
                >
                  <div className="flex h-full min-h-[60vh] items-center justify-center">
                    <div className={`shrink-0 ${getKycZoomWidthClass(zoom)}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={blobUrl}
                        alt={`Evidence: ${step.step_type}`}
                        className="h-auto w-full max-w-none rounded object-contain select-none pointer-events-none"
                        draggable={false}
                      />
                    </div>
                  </div>
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
                <div className="flex flex-col items-center justify-center py-6">
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
          <div className="flex items-center gap-2 rounded-md border border-amber-300/60 dark:border-amber-600/30 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Scheduled for purge:{" "}
            <time dateTime={artifact.purge_after}>
              {new Date(artifact.purge_after).toLocaleDateString("en-ZA")}
            </time>
          </div>
        )}

        {/* Decision area (inline in lightbox) */}
        {!deciding ? (
          <DialogFooter className="flex-wrap gap-2">
            {evidenceDeskEnabled && (
              <Button asChild variant="outline" size="sm" className="gap-1">
                <Link href="/admin/verification/evidence">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Full Evidence Desk
                </Link>
              </Button>
            )}
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              className="text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
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
              className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950"
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
                {displayName || step.user_id.slice(0, 8) + "..."}
              </span>
            </div>

            {decision === "approved" ? (
              <p className="text-sm text-muted-foreground">
                This will mark the step as approved. If all 4 steps are approved, the account will
                be verified.
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
                    {KYC_REVIEW_REASON_CODES.map((rc) => (
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
        {/* Print protection — moved to globals.css for CSP nonce compliance */}
      </DialogContent>
    </Dialog>
  );
}
