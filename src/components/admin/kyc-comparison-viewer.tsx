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
import {
  Loader2,
  FileText,
  AlertTriangle,
  RefreshCw,
  X,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
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
  stepId: string;
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
  stepId,
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDocIndex, setSelectedDocIndex] = useState(0);

  // Fetch metadata and load artifacts
  useEffect(() => {
    if (!isOpen || !userId || !stepId) return;

    const createdUrls: string[] = [];

    async function loadArtifacts() {
      setLoading(true);
      setError(null);
      setArtifacts([]);
      setBlobUrls({});

      try {
        // Fetch metadata with GET request using query params
        const params = new URLSearchParams({
          stepId,
          userId,
        });
        const metaRes = await fetch(`/api/admin/verification/evidence/metadata?${params}`, {
          method: "GET",
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
        const loadedArtifacts: Artifact[] = meta.artifacts || [];

        if (loadedArtifacts.length === 0) {
          setError("No documents uploaded yet");
          return;
        }

        // Sort: ID docs first, then selfies, then others
        const sorted = loadedArtifacts.sort((a, b) => {
          const order: Record<string, number> = {
            id_doc: 0,
            selfie: 1,
            location: 2,
            phone: 3,
          };
          return (order[a.step_type] ?? 99) - (order[b.step_type] ?? 99);
        });

        setArtifacts(sorted);

        // Preload all artifacts
        for (const artifact of sorted) {
          try {
            const evidenceRes = await fetch(
              `/api/admin/verification/evidence?artifactId=${artifact.id}`,
              {
                method: "GET",
              }
            );

            if (evidenceRes.ok) {
              const blob = await evidenceRes.blob();
              const objectUrl = URL.createObjectURL(blob);
              createdUrls.push(objectUrl);
              setBlobUrls((prev) => ({
                ...prev,
                [artifact.id]: objectUrl,
              }));
            }
          } catch (e) {
            console.error(`Failed to load artifact ${artifact.id}:`, e);
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
  }, [isOpen, userId, stepId]);

  const currentArtifact = artifacts[selectedDocIndex];
  const currentBlobUrl = currentArtifact ? blobUrls[currentArtifact.id] : null;

  const getStepLabel = (type: string) => {
    const labels: Record<string, string> = {
      id_doc: "ID Document",
      selfie: "Selfie",
      location: "Location Proof",
      phone: "Phone",
    };
    return labels[type] || type;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="border-b">
          <div className="flex items-center justify-between w-full gap-4">
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-lg font-semibold">
                Verification Review: {displayName}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Compare documents to verify identity authenticity
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
                    setError(null);
                    setLoading(true);
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </CardContent>
            </Card>
          )}

          {!loading && !error && artifacts.length > 0 && (
            <div className="space-y-6">
              {/* Document selector tabs */}
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {artifacts.map((artifact, idx) => (
                  <Button
                    key={artifact.id}
                    variant={selectedDocIndex === idx ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedDocIndex(idx)}
                    className="whitespace-nowrap"
                  >
                    <div className="h-2 w-2 rounded-full p-0 mr-2 bg-current"></div>
                    {getStepLabel(artifact.step_type)}
                  </Button>
                ))}
              </div>

              {/* Document viewer */}
              {currentArtifact && (
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base">
                            {getStepLabel(currentArtifact.step_type)}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground mt-1">
                            Uploaded {new Date(currentArtifact.created_at).toLocaleString()}
                          </p>
                        </div>
                        <Badge variant="secondary" className="shrink-0">
                          {(currentArtifact.file_size_bytes / 1024).toFixed(1)} KB
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {currentBlobUrl ? (
                        <div className="bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center max-h-96">
                          {currentArtifact.content_type?.startsWith("image") ? (
                            <Image
                              src={currentBlobUrl}
                              alt={getStepLabel(currentArtifact.step_type)}
                              width={1200}
                              height={900}
                              unoptimized
                              className="max-w-full max-h-96 object-contain"
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center p-8 text-center">
                              <FileText className="h-12 w-12 text-muted-foreground mb-2" />
                              <p className="text-sm text-muted-foreground">
                                {currentArtifact.content_type || "Document"}
                              </p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="bg-gray-100 rounded-lg h-64 flex items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Navigation */}
                  {artifacts.length > 1 && (
                    <div className="flex items-center justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setSelectedDocIndex((p) => (p > 0 ? p - 1 : artifacts.length - 1))
                        }
                      >
                        <ChevronLeft className="h-4 w-4 mr-2" />
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        {selectedDocIndex + 1} of {artifacts.length}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setSelectedDocIndex((p) => (p < artifacts.length - 1 ? p + 1 : 0))
                        }
                      >
                        Next
                        <ChevronRight className="h-4 w-4 ml-2" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action buttons footer */}
        {!loading && !error && artifacts.length > 0 && (
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
