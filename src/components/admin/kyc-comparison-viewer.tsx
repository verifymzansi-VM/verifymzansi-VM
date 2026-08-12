"use client";

import Image from "next/image";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
  RotateCcw,
  ZoomIn,
  ZoomOut,
  ScanFace,
  ShieldCheck,
} from "lucide-react";
import { getKycEvidenceErrorMessage } from "./kyc-evidence-errors";
import {
  getCachedKycArtifactBlob,
  setCachedKycArtifactBlob,
} from "@/lib/utils/kyc-artifact-blob-cache";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { getKycZoomWidthClass } from "./kyc-review-constants";

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

interface RiskSignal {
  id: string;
  artifact_id: string | null;
  signal_code: string;
  severity: string;
  value_json: Record<string, unknown>;
  created_at: string;
}

interface ProviderResult {
  id: string;
  artifact_id: string;
  provider_name: string;
  provider_status: string;
  face_match_score: number | null;
  liveness_score: number | null;
  doc_auth_score: number | null;
}

const SIGNAL_SEVERITY_CLASSES: Record<string, string> = {
  block:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  info: "border-warm-200 bg-warm-50 text-warm-800 dark:border-warm-700 dark:bg-muted dark:text-warm-200",
};

/** Human-friendly labels for the signal codes an admin is likely to see here. */
const SIGNAL_LABELS: Record<string, string> = {
  selfie_not_camera_captured: "Selfie uploaded as a file (not live camera)",
  liveness_not_verified: "Liveness challenge not completed",
  duplicate_sha256: "Exact duplicate of another account's image",
  near_duplicate_phash: "Near-duplicate of another account's image",
  software_edited: "Image edited with photo software",
  no_camera_exif: "No camera EXIF data",
  stale_photo: "Photo is older than 24 hours",
  blurry_image: "Image is blurry",
  low_liveness_score: "Low liveness score",
  low_face_match_score: "Selfie does not match ID photo",
  id_number_reuse: "ID number already linked to another account",
  velocity_resubmit: "Unusually many uploads in 24h",
  rapid_step_completion: "Steps completed suspiciously fast",
};

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
  const [riskSignals, setRiskSignals] = useState<RiskSignal[]>([]);
  const [providerResults, setProviderResults] = useState<ProviderResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [panelZoom, setPanelZoom] = useState<Record<string, number>>({
    id_doc: 1,
    selfie: 1,
  });
  const mousePanRef = useRef<{
    element: HTMLDivElement;
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const panelViewportRef = useRef<Record<string, HTMLDivElement | null>>({
    id_doc: null,
    selfie: null,
  });

  // Fetch metadata and load artifacts
  useEffect(() => {
    if (!isOpen || !userId) return;

    let cancelled = false;
    const createdUrls: string[] = [];

    async function loadArtifacts() {
      setLoading(true);
      setError(null);
      setArtifacts([]);
      setBlobUrls({});
      setArtifactErrors({});
      setRiskSignals([]);
      setProviderResults([]);
      setPanelZoom({ id_doc: 1, selfie: 1 });

      try {
        const metaRes = await fetch(`/api/admin/verification/evidence/metadata`, {
          method: "POST",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ userId }),
        });

        if (!metaRes.ok) {
          const data = await metaRes.json().catch(() => ({}));
          if (data?.code === "not_found" || data?.code === "not_linked") {
            setError("No ID document or selfie uploaded yet");
            return;
          }
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

        // Capture risk signals + provider results so the admin can see fraud /
        // liveness signals (e.g. selfie_not_camera_captured, liveness_not_verified)
        // alongside the images instead of judging the photos blind.
        const loadedSignals: RiskSignal[] = Array.isArray(meta.riskSignals) ? meta.riskSignals : [];
        const loadedProviderResults: ProviderResult[] = Array.isArray(meta.providerResults)
          ? meta.providerResults
          : [];

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

        if (cancelled) return;
        setArtifacts(sorted);
        setRiskSignals(loadedSignals);
        setProviderResults(loadedProviderResults);

        // Preload artifacts in parallel and reuse cached blobs when available.
        const results = await Promise.all(
          sorted.map(async (artifact) => {
            try {
              let resolvedArtifact = artifact;

              const initialCachedBlob = getCachedKycArtifactBlob(artifact.id);
              if (initialCachedBlob) {
                const objectUrl = URL.createObjectURL(initialCachedBlob);
                createdUrls.push(objectUrl);
                return {
                  requestedId: artifact.id,
                  resolvedArtifact,
                  objectUrl,
                  error: null as string | null,
                };
              }

              let evidenceRes = await fetch(`/api/admin/verification/evidence`, {
                method: "POST",
                headers: withCsrfHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({ artifactId: artifact.id }),
              });

              if (!evidenceRes.ok) {
                const firstErrorData = await evidenceRes.json().catch(() => null);

                if (firstErrorData?.code === "not_found") {
                  const retryMetaRes = await fetch(`/api/admin/verification/evidence/metadata`, {
                    method: "POST",
                    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
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
                      const replacementCachedBlob = getCachedKycArtifactBlob(replacement.id);

                      if (replacementCachedBlob) {
                        const objectUrl = URL.createObjectURL(replacementCachedBlob);
                        createdUrls.push(objectUrl);
                        return {
                          requestedId: artifact.id,
                          resolvedArtifact,
                          objectUrl,
                          error: null as string | null,
                        };
                      }

                      evidenceRes = await fetch(`/api/admin/verification/evidence`, {
                        method: "POST",
                        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
                        body: JSON.stringify({ artifactId: replacement.id }),
                      });
                    }
                  }
                } else {
                  return {
                    requestedId: artifact.id,
                    resolvedArtifact,
                    objectUrl: null,
                    error: getKycEvidenceErrorMessage(
                      firstErrorData?.code,
                      firstErrorData?.error || "Failed to load document"
                    ),
                  };
                }
              }

              if (evidenceRes.ok) {
                const blob = await evidenceRes.blob();
                setCachedKycArtifactBlob(resolvedArtifact.id, blob);
                const objectUrl = URL.createObjectURL(blob);
                createdUrls.push(objectUrl);
                return {
                  requestedId: artifact.id,
                  resolvedArtifact,
                  objectUrl,
                  error: null as string | null,
                };
              }

              const data = await evidenceRes.json().catch(() => null);
              return {
                requestedId: artifact.id,
                resolvedArtifact,
                objectUrl: null,
                error: getKycEvidenceErrorMessage(
                  data?.code,
                  data?.error || "Failed to load document"
                ),
              };
            } catch (e) {
              return {
                requestedId: artifact.id,
                resolvedArtifact: artifact,
                objectUrl: null,
                error: e instanceof Error ? e.message : "Failed to load document",
              };
            }
          })
        );

        const nextBlobUrls: Record<string, string> = {};
        const nextArtifactErrors: Record<string, string> = {};
        const replacementByRequestedId = new Map<string, Artifact>();

        for (const result of results) {
          if (result.objectUrl) {
            nextBlobUrls[result.resolvedArtifact.id] = result.objectUrl;
          }
          if (result.error) {
            nextArtifactErrors[result.resolvedArtifact.id] = result.error;
          }
          if (result.resolvedArtifact.id !== result.requestedId) {
            replacementByRequestedId.set(result.requestedId, result.resolvedArtifact);
          }
        }

        if (cancelled) return;

        if (Object.keys(nextBlobUrls).length > 0) {
          setBlobUrls(nextBlobUrls);
        }
        setArtifactErrors(nextArtifactErrors);

        if (replacementByRequestedId.size > 0) {
          setArtifacts((prev) =>
            prev.map((existing) => replacementByRequestedId.get(existing.id) ?? existing)
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load documents");
      } finally {
        setLoading(false);
      }
    }

    void loadArtifacts();

    return () => {
      cancelled = true;
      // Cleanup blob URLs
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [isOpen, userId, retryToken]);

  const idArtifact = artifacts.find((artifact) => artifact.step_type === "id_doc") ?? null;
  const selfieArtifact = artifacts.find((artifact) => artifact.step_type === "selfie") ?? null;
  const comparisonArtifacts = [idArtifact, selfieArtifact].filter(
    (artifact): artifact is Artifact => Boolean(artifact)
  );

  // Signals attached to the selfie artifact drive the liveness verdict banner.
  const selfieSignals = selfieArtifact
    ? riskSignals.filter((s) => !s.artifact_id || s.artifact_id === selfieArtifact.id)
    : [];
  const selfieProvider = selfieArtifact
    ? (providerResults.find((p) => p.artifact_id === selfieArtifact.id) ?? null)
    : null;

  const hasSignal = (code: string) => selfieSignals.some((s) => s.signal_code === code);

  // Derive a single, easy-to-scan liveness verdict for the selfie.
  // IMPORTANT: the default (no signals, no provider score) must be "unknown",
  // not "ok" — selfies uploaded before the liveness feature existed have no
  // signals at all, so defaulting to green would falsely reassure the admin.
  type LivenessVerdict = {
    tone: "ok" | "warn" | "bad" | "unknown";
    label: string;
    detail: string;
  };
  const livenessVerdict: LivenessVerdict | null = selfieArtifact
    ? (() => {
        if (hasSignal("selfie_not_camera_captured")) {
          return {
            tone: "bad",
            label: "Uploaded file",
            detail:
              "This selfie was uploaded as a file, not captured live on camera. It cannot be trusted as proof of liveness — inspect carefully.",
          };
        }
        if (hasSignal("liveness_not_verified")) {
          return {
            tone: "warn",
            label: "Liveness not verified",
            detail:
              "The live-camera liveness challenge was not completed for this selfie. Confirm the face looks like a real, live person.",
          };
        }
        if (selfieProvider && typeof selfieProvider.liveness_score === "number") {
          return {
            tone: "ok",
            label: `Liveness ${selfieProvider.liveness_score}/100`,
            detail: "Captured live on camera with the liveness challenge completed.",
          };
        }
        // No negative signal, but also no positive proof of liveness (e.g. a
        // selfie uploaded before this check existed). Stay neutral.
        return {
          tone: "unknown",
          label: "Liveness unknown",
          detail:
            "No liveness data is on record for this selfie (it may predate the liveness check). Verify the face manually against the ID.",
        };
      })()
    : null;

  const getStepLabel = (type: string) => {
    const labels: Record<string, string> = {
      id_doc: "ID Document",
      selfie: "Selfie",
    };
    return labels[type] || type;
  };

  const setPanelZoomLevel = useCallback((stepType: string, targetZoom: number) => {
    const boundedZoom = Math.min(3, Math.max(0.5, targetZoom));
    setPanelZoom((prev) => ({
      ...prev,
      [stepType]: boundedZoom,
    }));

    if (boundedZoom <= 1) {
      const viewport = panelViewportRef.current[stepType];
      if (viewport) {
        viewport.scrollLeft = 0;
        viewport.scrollTop = 0;
      }
    }
  }, []);

  const handlePanelMouseDown = useCallback(
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

  const handlePanelMouseMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!mousePanRef.current) {
      return;
    }

    const current = mousePanRef.current;
    current.element.scrollLeft = current.scrollLeft - (e.clientX - current.x);
    current.element.scrollTop = current.scrollTop - (e.clientY - current.y);
  }, []);

  const handlePanelMouseUp = useCallback(() => {
    mousePanRef.current = null;
  }, []);

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
    const zoomLevel = panelZoom[artifact.step_type] ?? 1;
    const canZoom = artifact.content_type?.startsWith("image");

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
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="shrink-0">
                {(artifact.file_size_bytes / 1024).toFixed(1)} KB
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPanelZoomLevel(artifact.step_type, zoomLevel - 0.25)}
                disabled={!canZoom || zoomLevel <= 0.5}
                aria-label={`Zoom out ${getStepLabel(artifact.step_type)}`}
                title="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="w-10 text-center text-xs text-muted-foreground">
                {Math.round(zoomLevel * 100)}%
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPanelZoomLevel(artifact.step_type, zoomLevel + 0.25)}
                disabled={!canZoom || zoomLevel >= 3}
                aria-label={`Zoom in ${getStepLabel(artifact.step_type)}`}
                title="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPanelZoomLevel(artifact.step_type, 1)}
                disabled={!canZoom || zoomLevel === 1}
                aria-label={`Reset zoom ${getStepLabel(artifact.step_type)}`}
                title="Reset zoom"
              >
                Reset
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {artifactError ? (
            <div className="flex min-h-[24rem] flex-col items-center justify-center gap-3 rounded-lg border border-red-200 bg-red-50 p-6 text-center">
              <AlertTriangle className="h-8 w-8 text-red-600" />
              <p className="text-sm font-medium text-red-900">{artifactError}</p>
            </div>
          ) : blobUrl ? (
            <div
              className={`min-h-[24rem] overflow-auto rounded-lg bg-gray-100 ${
                zoomLevel > 1 ? "cursor-grab active:cursor-grabbing" : ""
              }`}
              ref={(node) => {
                panelViewportRef.current[artifact.step_type] = node;
              }}
              onMouseDown={(e) => handlePanelMouseDown(zoomLevel, e)}
              onMouseMove={handlePanelMouseMove}
              onMouseUp={handlePanelMouseUp}
              onMouseLeave={handlePanelMouseUp}
            >
              {artifact.content_type?.startsWith("image") ? (
                <div className="flex min-h-[24rem] items-center justify-center p-4">
                  <div className={`relative shrink-0 ${getKycZoomWidthClass(zoomLevel)}`}>
                    <Image
                      src={blobUrl}
                      alt={getStepLabel(artifact.step_type)}
                      width={1200}
                      height={900}
                      unoptimized
                      draggable={false}
                      className="h-auto w-full max-w-none object-contain select-none pointer-events-none"
                    />
                  </div>
                </div>
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
      <DialogContent className="max-w-5xl max-sm:max-w-[calc(100vw-1rem)] max-h-[90vh] overflow-y-auto sm:overflow-hidden flex flex-col">
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
            <div className="space-y-4">
              {/* Liveness verdict banner — the single most important signal for
                  deciding whether the selfie is a real, live person. */}
              {livenessVerdict && (
                <div
                  className={`flex items-start gap-3 rounded-md border p-3 text-sm ${
                    livenessVerdict.tone === "bad"
                      ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
                      : livenessVerdict.tone === "warn"
                        ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                        : livenessVerdict.tone === "ok"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                          : "border-warm-300 bg-warm-50 text-warm-900 dark:border-warm-700 dark:bg-muted dark:text-warm-200"
                  }`}
                >
                  {livenessVerdict.tone === "ok" ? (
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <div>
                    <p className="font-medium">Selfie: {livenessVerdict.label}</p>
                    <p className="mt-0.5 text-xs opacity-90">{livenessVerdict.detail}</p>
                  </div>
                </div>
              )}

              {/* Face-match score when a provider returned one. */}
              {selfieProvider && typeof selfieProvider.face_match_score === "number" && (
                <div className="flex items-center gap-2 rounded-md border border-warm-200 bg-warm-50 p-3 text-sm dark:border-warm-700 dark:bg-muted">
                  <ScanFace className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p>
                    Face match (selfie vs ID):{" "}
                    <span className="font-semibold">{selfieProvider.face_match_score}/100</span>
                  </p>
                </div>
              )}

              {/* Detailed fraud / risk signals for the two images on screen. */}
              {(() => {
                const visibleIds = new Set(comparisonArtifacts.map((a) => a.id));
                const relevant = riskSignals.filter(
                  (s) => !s.artifact_id || visibleIds.has(s.artifact_id)
                );
                if (relevant.length === 0) return null;
                return (
                  <div className="space-y-2">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Fraud &amp; risk signals
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {relevant.map((s) => (
                        <span
                          key={s.id}
                          title={s.signal_code}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                            SIGNAL_SEVERITY_CLASSES[s.severity] ?? SIGNAL_SEVERITY_CLASSES.info
                          }`}
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {SIGNAL_LABELS[s.signal_code] ?? s.signal_code.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className={!selfieArtifact ? "lg:col-span-2" : undefined}>
                  {renderArtifactPanel(idArtifact)}
                </div>
                {selfieArtifact ? <div>{renderArtifactPanel(selfieArtifact)}</div> : null}
              </div>
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
