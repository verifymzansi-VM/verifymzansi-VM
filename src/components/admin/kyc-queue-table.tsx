"use client";

import { useState, useCallback } from "react";
import { formatRelativeTime } from "@/lib/utils/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
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
  Phone,
  Camera,
  CreditCard,
  Loader2,
  Eye,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { KycComparisonViewer } from "./kyc-comparison-viewer";
import { getKycEvidenceErrorMessage } from "./kyc-evidence-errors";
import type { PendingVerificationGroup } from "@/lib/utils/admin-queries";
import { OVERRIDE_REASON_CODES } from "@/lib/constants/verification";
import { withCsrfHeaders } from "@/lib/utils/csrf";

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
  reviewed_at?: string | null;
  account_display_name?: string | null;
  account_verification_status?: string | null;
  risk_level?: string | null;
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
  groups: PendingVerificationGroup[];
  onDecisionComplete?: () => void;
  evidenceDeskEnabled?: boolean;
}

const STEP_ICONS: Record<string, React.ElementType> = {
  phone: Phone,
  id_doc: CreditCard,
  selfie: Camera,
};

const STEP_LABELS: Record<string, string> = {
  phone: "Phone Verification",
  id_doc: "ID Document",
  selfie: "Selfie Verification",
};

const VIEWABLE_STEP_TYPES = new Set(["id_doc", "selfie"]);

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
  groups,
  onDecisionComplete,
  evidenceDeskEnabled = false,
}: KycQueueTableProps) {
  const { toast } = useToast();
  const [selectedStep, setSelectedStep] = useState<VerificationStep | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected" | "needs_resubmission" | null>(
    null
  );
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [overrideReasonCode, setOverrideReasonCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Lightbox state for inline document preview
  const [lightboxStep, setLightboxStep] = useState<VerificationStep | null>(null);
  const [lightboxArtifact, setLightboxArtifact] = useState<Artifact | null>(null);
  const [viewingStepId, setViewingStepId] = useState<string | null>(null);

  // Comparison viewer state
  const [comparisonViewerOpen, setComparisonViewerOpen] = useState(false);
  const [comparisonUserId, setComparisonUserId] = useState<string | null>(null);
  const [comparisonDisplayName, setComparisonDisplayName] = useState("");

  const handleComparisonClick = useCallback((userId: string, displayName: string) => {
    setComparisonUserId(userId);
    setComparisonDisplayName(displayName);
    setComparisonViewerOpen(true);
  }, []);

  const getLatestArtifactForStep = useCallback((artifacts: Artifact[], stepType: string) => {
    const matches = artifacts
      .filter((artifact) => artifact.step_type === stepType)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return matches[0] ?? null;
  }, []);

  const handleRowViewClick = useCallback(
    async (step: VerificationStep) => {
      if (!VIEWABLE_STEP_TYPES.has(step.step_type)) {
        return;
      }

      setViewingStepId(step.id);

      try {
        const metaRes = await fetch(`/api/admin/verification/evidence/metadata`, {
          method: "POST",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ stepId: step.id, userId: step.user_id }),
        });

        if (!metaRes.ok) {
          const data = await metaRes.json().catch(() => null);
          throw new Error(
            getKycEvidenceErrorMessage(data?.code, data?.error || "Failed to load metadata")
          );
        }

        const meta = await metaRes.json();
        const resolvedArtifact = getLatestArtifactForStep(meta.artifacts || [], step.step_type);

        if (!resolvedArtifact) {
          throw new Error("No document uploaded");
        }

        setLightboxStep(step);
        setLightboxArtifact(resolvedArtifact);
      } catch (err) {
        toast({
          title: "Unable to open evidence",
          description: err instanceof Error ? err.message : "Failed to load document",
          variant: "destructive",
        });
      } finally {
        setViewingStepId(null);
      }
    },
    [getLatestArtifactForStep, toast]
  );

  if (!groups.length) {
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
    setOverrideReasonCode("");
    setError("");
  }

  function closeDialog() {
    setSelectedStep(null);
    setDecision(null);
    setReasonCode("");
    setReasonNote("");
    setOverrideReasonCode("");
    setError("");
  }

  async function submitDecision() {
    if (!selectedStep || !decision) return;

    if (decision !== "approved" && !reasonCode) {
      setError("Please select a reason code.");
      return;
    }

    const isHighRisk = selectedStep.risk_level === "high" || selectedStep.risk_level === "critical";
    if (decision === "approved" && isHighRisk && !overrideReasonCode) {
      setError("Override reason code is required when approving high-risk steps.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/verification/decide", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          stepId: selectedStep.id,
          decision,
          reasonCode: decision !== "approved" ? reasonCode : undefined,
          reasonNote: reasonNote || undefined,
          overrideReasonCode: overrideReasonCode || undefined,
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
        {groups.map((group) => {
          if (!group.steps.length) {
            return null;
          }

          return (
            <Card key={group.user_id}>
              <CardContent className="py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{group.account_display_name}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {group.pending_step_count} pending
                          </Badge>
                          {group.account_verification_status ? (
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {group.account_verification_status.replace(/_/g, " ")}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Latest submission {formatRelativeTime(group.latest_created_at)}
                        </p>
                      </div>
                      {evidenceDeskEnabled && (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="default"
                            className="h-8 bg-brand-blue hover:bg-brand-blue/90"
                            onClick={() =>
                              handleComparisonClick(
                                group.user_id,
                                group.account_display_name || group.user_id
                              )
                            }
                            title="Compare ID and selfie"
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            <span className="text-xs">View Docs</span>
                          </Button>
                          <Button
                            asChild
                            size="sm"
                            variant="ghost"
                            className="h-8 text-brand-blue hover:text-brand-blue/80 hover:bg-brand-blue/10"
                            title="View Evidence"
                          >
                            <Link href="/admin/verification/evidence">
                              <Eye className="h-4 w-4 mr-1" />
                              <span className="text-xs">Evidence</span>
                            </Link>
                          </Button>
                        </div>
                      )}
                      {!evidenceDeskEnabled && (
                        <Button
                          size="sm"
                          variant="default"
                          className="h-8 bg-brand-blue hover:bg-brand-blue/90"
                          onClick={() =>
                            handleComparisonClick(
                              group.user_id,
                              group.account_display_name || group.user_id
                            )
                          }
                          title="Compare ID and selfie"
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          <span className="text-xs">View Docs</span>
                        </Button>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {group.steps.map((step) => (
                        <Badge
                          key={`${group.user_id}-${step.id}`}
                          variant="outline"
                          className="text-[10px]"
                        >
                          {STEP_LABELS[step.step_type] || step.step_type}
                        </Badge>
                      ))}
                    </div>

                    <div className="space-y-2">
                      {group.steps.map((step) => {
                        const StepIcon = STEP_ICONS[step.step_type] || FileCheck;
                        const stepLabel = STEP_LABELS[step.step_type] || step.step_type;
                        const canViewStep = VIEWABLE_STEP_TYPES.has(step.step_type);
                        const isViewingStep = viewingStepId === step.id;

                        return (
                          <div
                            key={step.id}
                            className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-3 md:flex-row md:items-center md:justify-between"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                                <StepIcon className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium">{stepLabel}</span>
                                  <Badge
                                    variant={step.status === "pending" ? "default" : "secondary"}
                                    className="text-[10px]"
                                  >
                                    {step.status}
                                  </Badge>
                                  {step.reviewed_at && step.status === "pending" && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] border-amber-500 text-amber-600"
                                    >
                                      Resubmission
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Submitted {formatRelativeTime(step.created_at)}
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-1 flex-shrink-0 flex-wrap">
                              {canViewStep && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 text-brand-blue hover:text-brand-blue/80 hover:bg-brand-blue/10"
                                  onClick={() => void handleRowViewClick(step)}
                                  title="View"
                                  disabled={isViewingStep}
                                >
                                  {isViewingStep ? (
                                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                  ) : (
                                    <Eye className="h-4 w-4 mr-1" />
                                  )}
                                  <span className="hidden sm:inline text-xs">View</span>
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
                        );
                      })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Document Comparison Viewer */}
      {comparisonUserId && (
        <KycComparisonViewer
          isOpen={comparisonViewerOpen}
          userId={comparisonUserId}
          displayName={comparisonDisplayName}
          onClose={() => {
            setComparisonViewerOpen(false);
            setComparisonUserId(null);
          }}
          disableActions={false}
        />
      )}

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
                    {selectedStep.account_display_name || selectedStep.user_id.slice(0, 8) + "..."}
                  </strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {decision === "approved" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This will mark the step as approved. If all verification steps are now approved, the
                account will be marked as verified.
              </p>
              {selectedStep?.reviewed_at && selectedStep?.status === "pending" && (
                <div className="rounded-md border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-700 dark:text-amber-400">
                  <strong>Note:</strong> This is a resubmission — the step was previously reviewed.
                  Ensure the user has corrected the flagged issue before approving.
                </div>
              )}
              {(selectedStep?.risk_level === "high" || selectedStep?.risk_level === "critical") && (
                <div className="space-y-2">
                  <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-200">
                    This step has <strong>{selectedStep.risk_level}</strong> risk. An override
                    reason is required to approve.
                  </div>
                  <div>
                    <Label htmlFor="override-reason-code" className="text-sm font-medium">
                      Override Reason <span className="text-destructive">*</span>
                    </Label>
                    <select
                      id="override-reason-code"
                      title="Override reason code"
                      value={overrideReasonCode}
                      onChange={(e) => setOverrideReasonCode(e.target.value)}
                      className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Select override reason…</option>
                      {OVERRIDE_REASON_CODES.map((code) => (
                        <option key={code} value={code}>
                          {code.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
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
