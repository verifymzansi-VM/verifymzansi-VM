"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, FileText, AlertTriangle, RefreshCw, X, RotateCcw } from "lucide-react";
import { getKycEvidenceErrorMessage } from "./kyc-evidence-errors";

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

interface DocumentViewerProps {
  isOpen: boolean;
  userId: string;
  displayName: string;
  onClose: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onResubmit?: () => void;
  disableActions?: boolean;
  isLoading?: boolean;
}

/**
 * Enhanced KYC document comparison viewer
 * Shows ID and Selfie side-by-side for easy comparison
 */
export function KycComparisonViewer({
  isOpen,
  userId,
  displayName,
  onClose,
  onApprove,
  onReject,
  onResubmit,
  disableActions = false,
  isLoading = false,
}: DocumentViewerProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const [artifactErrors, setArtifactErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // Fetch metadata and load artifacts
  useEffect(() => {
    if (!isOpen || !userId) return;

    const createdUrls: string[] = [];

    async function loadArtifacts() {
      setLoading(true);
      setError(null);
      setArtifacts([]);
      setBlobUrls({});
      setArtifactErrors({});

      try {
        const metaRes = await fetch(`/api/admin/verification/evidence/metadata`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });

        if (!metaRes.ok) {
          const data = await metaRes.json().catch(() => ({}));
          const errorMsg = getKycEvidenceErrorMessage(
            data?.code,
            data?.error || `Metadata error: ${metaRes.status}`
          );
          throw new Error(errorMsg);
        }

        const meta = await metaRes.json();
        const loadedArtifacts: Artifact[] = (meta.artifacts || []).filter(
          (artifact: Artifact) => artifact.step_type === "id_doc" || artifact.step_type === "selfie"
        );

        if (loadedArtifacts.length === 0) {
          setError("No ID document or selfie uploaded yet");
          return;
        }

        const sorted = loadedArtifacts.sort((a, b) => {
          const order: Record<string, number> = {
            id_doc: 0,
            selfie: 1,
          };
          const stepOrder = (order[a.step_type] ?? 99) - (order[b.step_type] ?? 99);
          if (stepOrder !== 0) {
            return stepOrder;
          }

          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

        setArtifacts(sorted);

        // Preload all artifacts
        for (const artifact of sorted) {
          try {
            let resolvedArtifact = artifact;
            let evidenceRes = await fetch(`/api/admin/verification/evidence`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ artifactId: artifact.id }),
            });

            if (!evidenceRes.ok) {
              const firstErrorData = await evidenceRes.json().catch(() => null);

              if (firstErrorData?.code === "not_found") {
                const retryMetaRes = await fetch(`/api/admin/verification/evidence/metadata`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userId }),
                });

                if (retryMetaRes.ok) {
                  const retryMeta = await retryMetaRes.json();
                  const retryArtifacts: Artifact[] = retryMeta.artifacts || [];
                  const replacement = retryArtifacts
                    .filter((a: Artifact) => a.step_type === artifact.step_type)
                    .sort(
                      (a: Artifact, b: Artifact) =>
                        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                    )[0];

                  if (replacement && replacement.id !== artifact.id) {
                    resolvedArtifact = replacement;
                    evidenceRes = await fetch(`/api/admin/verification/evidence`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ artifactId: replacement.id }),
                    });

                    if (evidenceRes.ok) {
                      setArtifacts((prev) =>
                        prev.map((existing) =>
                          existing.id === artifact.id ? replacement : existing
                        )
                      );
                    }
                  }
                }
              } else {
                setArtifactErrors((prev) => ({
                  ...prev,
                  [artifact.id]: getKycEvidenceErrorMessage(
                    firstErrorData?.code,
                    firstErrorData?.error || "Failed to load document"
                  ),
                }));
                continue;
              }
            }

            if (evidenceRes.ok) {
              const blob = await evidenceRes.blob();
              const objectUrl = URL.createObjectURL(blob);
              createdUrls.push(objectUrl);
              setBlobUrls((prev) => ({
                ...prev,
                [resolvedArtifact.id]: objectUrl,
              }));
              setArtifactErrors((prev) => {
                const next = { ...prev };
                delete next[artifact.id];
                delete next[resolvedArtifact.id];
                return next;
              });
            } else {
              const data = await evidenceRes.json().catch(() => null);
              setArtifactErrors((prev) => ({
                ...prev,
                [resolvedArtifact.id]: getKycEvidenceErrorMessage(
                  data?.code,
                  data?.error || "Failed to load document"
                ),
              }));
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to load document";
            setArtifactErrors((prev) => ({
              ...prev,
              [artifact.id]: message,
            }));
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load documents");
      } finally {
        setLoading(false);
      }
    }

    loadArtifacts();

    return () => {
      // Cleanup blob URLs
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [isOpen, userId, retryToken]);

  const idArtifact = artifacts.find((artifact) => artifact.step_type === "id_doc") ?? null;
  const selfieArtifact = artifacts.find((artifact) => artifact.step_type === "selfie") ?? null;
  const comparisonArtifacts = [idArtifact, selfieArtifact].filter(
    (artifact): artifact is Artifact => Boolean(artifact)
  );

  const getStepLabel = (type: string) => {
    const labels: Record<string, string> = {
      id_doc: "ID Document",
      selfie: "Selfie",
    };
    return labels[type] || type;
  };

  const renderArtifactPanel = (artifact: Artifact | null) => {
    if (!artifact) {
      return (
        <Card className="border-dashed">
          <CardContent className="flex min-h-[24rem] flex-col items-center justify-center gap-3 p-6 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/70" />
            <div>
              <p className="text-sm font-medium text-foreground">Document missing</p>
              <p className="text-sm text-muted-foreground">
                The user has not uploaded this document yet.
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }

    const blobUrl = blobUrls[artifact.id];
    const artifactError = artifactErrors[artifact.id];

    return (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">{getStepLabel(artifact.step_type)}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Uploaded {new Date(artifact.created_at).toLocaleString()}
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0">
              {(artifact.file_size_bytes / 1024).toFixed(1)} KB
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {artifactError ? (
            <div className="flex min-h-[24rem] flex-col items-center justify-center gap-3 rounded-lg border border-red-200 bg-red-50 p-6 text-center">
              <AlertTriangle className="h-8 w-8 text-red-600" />
              <p className="text-sm font-medium text-red-900">{artifactError}</p>
            </div>
          ) : blobUrl ? (
            <div className="flex min-h-[24rem] items-center justify-center overflow-hidden rounded-lg bg-gray-100">
              {artifact.content_type?.startsWith("image") ? (
                <Image
                  src={blobUrl}
                  alt={getStepLabel(artifact.step_type)}
                  width={1200}
                  height={900}
                  unoptimized
                  className="max-h-[32rem] max-w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center justify-center p-8 text-center">
                  <FileText className="mb-2 h-12 w-12 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {artifact.content_type || "Document"}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-[24rem] items-center justify-center rounded-lg bg-gray-100">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="border-b">
          <div className="flex items-center justify-between w-full gap-4">
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-lg font-semibold">
                Identity Comparison: {displayName}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Compare the selfie against the ID document to verify the same person.
              </DialogDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 shrink-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Main content area */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="flex items-center gap-3 p-4">
                <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-900">{error}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRetryToken((value) => value + 1);
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </CardContent>
            </Card>
          )}

          {!loading && !error && comparisonArtifacts.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={!selfieArtifact ? "lg:col-span-2" : undefined}>
                {renderArtifactPanel(idArtifact)}
              </div>
              {selfieArtifact ? <div>{renderArtifactPanel(selfieArtifact)}</div> : null}
            </div>
          )}
        </div>

        {/* Action buttons footer */}
        {!loading && !error && comparisonArtifacts.length > 0 && (
          <div className="border-t bg-muted/30 p-4 flex items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isLoading || disableActions}>
              Cancel
            </Button>
            {onResubmit && (
              <Button variant="outline" onClick={onResubmit} disabled={isLoading || disableActions}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Resubmit
              </Button>
            )}
            {onReject && (
              <Button
                variant="destructive"
                onClick={onReject}
                disabled={isLoading || disableActions}
              >
                <X className="h-4 w-4 mr-2" />
                Reject
              </Button>
            )}
            {onApprove && (
              <Button variant="default" onClick={onApprove} disabled={isLoading || disableActions}>
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Approve
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
