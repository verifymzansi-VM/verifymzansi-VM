"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Search,
  ShieldCheck,
  AlertTriangle,
  Eye,
  FileText,
  Camera,
  MapPin,
  Phone,
  Columns2,
} from "lucide-react";
import { EvidenceViewer } from "./evidence-viewer";
import { EvidenceMetadataPanel } from "./evidence-metadata-panel";
import { EvidenceDecisionControls } from "./evidence-decision-controls";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import type { Artifact, EvidenceMetadata, EvidenceStep } from "./evidence-types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STEP_ICONS: Record<string, React.ReactNode> = {
  phone: <Phone className="h-4 w-4" />,
  id_doc: <FileText className="h-4 w-4" />,
  selfie: <Camera className="h-4 w-4" />,
  location: <MapPin className="h-4 w-4" />,
};

const RISK_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low: "bg-green-100 text-green-800 border-green-200",
};

const SIGNAL_SEVERITY_COLORS: Record<string, string> = {
  block: "bg-red-100 text-red-800 border-red-200",
  warn: "bg-yellow-100 text-yellow-800 border-yellow-200",
  info: "bg-green-100 text-green-800 border-green-200",
};

function getLatestArtifactForStep(artifacts: Artifact[], stepType: string): Artifact | null {
  const matches = artifacts
    .filter((artifact) => artifact.step_type === stepType)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return matches[0] ?? null;
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function EvidenceDeskClient({
  initialStepId,
  initialUserId,
}: {
  initialStepId?: string;
  initialUserId?: string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [stepId, setStepId] = useState(initialStepId ?? "");
  const [userId, setUserId] = useState(initialUserId ?? "");
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<EvidenceMetadata | null>(null);
  const [selectedStep, setSelectedStep] = useState<EvidenceStep | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [comparisonMode, setComparisonMode] = useState(false);
  const accountProfile = metadata?.accountProfile ?? metadata?.sellerProfile ?? null;
  const verificationStatus =
    accountProfile?.account_verification_status ?? accountProfile?.account_verification_status;

  const fetchMetadata = useCallback(
    async (sid?: string, uid?: string) => {
      const queryStepId = sid ?? stepId;
      const queryUserId = uid ?? userId;
      if (!queryStepId && !queryUserId) return;

      setLoading(true);
      try {
        const res = await fetch(`/api/admin/verification/evidence/metadata`, {
          method: "POST",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            ...(queryStepId ? { stepId: queryStepId } : {}),
            ...(queryUserId ? { userId: queryUserId } : {}),
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to fetch evidence");
        }
        const data: EvidenceMetadata = await res.json();
        setMetadata(data);

        // Auto-select first step
        if (data.steps.length > 0) {
          const initialSelectedStep = data.steps[0];
          setSelectedStep(initialSelectedStep);
          setSelectedArtifact(
            getLatestArtifactForStep(data.artifacts, initialSelectedStep.step_type)
          );
        } else if (data.artifacts.length > 0) {
          setSelectedArtifact(data.artifacts[0]);
        } else {
          setSelectedArtifact(null);
        }
      } catch (err) {
        toast({
          title: "Error loading evidence",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    },
    [stepId, userId, toast]
  );

  // Auto-fetch if initial params provided
  useEffect(() => {
    if (initialStepId || initialUserId) {
      queueMicrotask(() => {
        void fetchMetadata(initialStepId, initialUserId);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    void fetchMetadata();
  }

  function handleDecisionComplete() {
    // Refresh metadata after a decision
    void fetchMetadata();
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <Card className="border-warm-200/70 dark:border-warm-700/70">
        <CardContent className="pt-6">
          <form noValidate onSubmit={handleSearch} className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="stepId" className="text-xs">
                Step ID
              </Label>
              <Input
                id="stepId"
                placeholder="Verification step UUID"
                value={stepId}
                onChange={(e) => setStepId(e.target.value)}
                className="w-72"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="userId" className="text-xs">
                User ID
              </Label>
              <Input
                id="userId"
                placeholder="Account user UUID"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-72"
              />
            </div>
            <Button
              type="submit"
              disabled={loading || (!stepId && !userId)}
              variant="outline"
              className="gap-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Load Evidence
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Main content */}
      {loading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {metadata && !loading && (
        <div className="grid gap-6 xl:grid-cols-3">
          {/* Left: Steps + Decision Controls */}
          <div className="space-y-4 xl:col-span-1">
            {/* Account info */}
            {accountProfile && (
              <Card className="border-warm-200/70 dark:border-warm-700/70">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Account Profile</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p className="font-medium">{accountProfile.display_name}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {verificationStatus}
                    </Badge>
                    {accountProfile.location_province && (
                      <span className="text-xs text-muted-foreground">
                        {accountProfile.location_city}, {accountProfile.location_province}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Steps list */}
            <Card className="border-warm-200/70 dark:border-warm-700/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Verification Steps</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {metadata.steps.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No steps found.</p>
                ) : (
                  metadata.steps.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSelectedStep(s);
                        setComparisonMode(false);
                        setSelectedArtifact(
                          getLatestArtifactForStep(metadata.artifacts, s.step_type)
                        );
                      }}
                      className={`w-full rounded-md border p-3 text-left text-sm transition-colors hover:bg-warm-50 dark:hover:bg-warm-900 ${
                        selectedStep?.id === s.id
                          ? "border-brand-blue bg-brand-blue/5"
                          : "border-warm-200/70 dark:border-warm-700/70"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 font-medium capitalize">
                          {STEP_ICONS[s.step_type] ?? <Eye className="h-4 w-4" />}
                          {s.step_type.replace("_", " ")}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            s.status === "approved"
                              ? "border-brand-green/40 text-brand-green"
                              : s.status === "rejected"
                                ? "border-destructive/40 text-destructive"
                                : "border-amber-400/40 text-amber-600"
                          }`}
                        >
                          {s.status}
                        </Badge>
                      </div>
                      {s.risk_level && (
                        <div className="mt-1 flex items-center gap-2">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                              RISK_COLORS[s.risk_level] ?? ""
                            }`}
                          >
                            {s.risk_level} risk
                          </span>
                          {s.risk_score !== null && (
                            <span className="text-xs text-muted-foreground">
                              Score: {s.risk_score}
                            </span>
                          )}
                        </div>
                      )}
                      {s.auto_status && (
                        <p className="mt-1 text-xs text-muted-foreground">Auto: {s.auto_status}</p>
                      )}
                    </button>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Risk signals */}
            {metadata.riskSignals.length > 0 && (
              <Card className="border-warm-200/70 dark:border-warm-700/70">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    Risk Signals
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {metadata.riskSignals.map((rs) => (
                    <div
                      key={rs.id}
                      className={`rounded-md border p-2 text-xs ${
                        SIGNAL_SEVERITY_COLORS[rs.severity] ??
                        "border-warm-200/70 dark:border-warm-700/70"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium capitalize">
                          {rs.signal_code.replace(/_/g, " ")}
                        </p>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {rs.severity}
                        </Badge>
                      </div>
                      {rs.value_json && Object.keys(rs.value_json).length > 0 && (
                        <pre className="mt-1 max-h-24 overflow-auto rounded bg-warm-50 p-1.5 text-[10px] break-all whitespace-pre-wrap text-muted-foreground dark:bg-muted">
                          {JSON.stringify(rs.value_json, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Decision controls */}
            {selectedStep && selectedStep.status === "pending" && (
              <EvidenceDecisionControls step={selectedStep} onComplete={handleDecisionComplete} />
            )}
          </div>

          {/* Right: Evidence viewer + metadata */}
          <div className="space-y-4 xl:col-span-2">
            {/* Artifact selector */}
            {metadata.artifacts.length > 1 &&
              (() => {
                const idArtifact = getLatestArtifactForStep(metadata.artifacts, "id_doc");
                const selfieArtifact = getLatestArtifactForStep(metadata.artifacts, "selfie");
                const canCompare = !!(idArtifact && selfieArtifact);

                return (
                  <Card className="border-warm-200/70 dark:border-warm-700/70">
                    <CardContent className="flex flex-wrap items-center gap-2 pt-4">
                      {metadata.artifacts.map((a) => (
                        <Button
                          key={a.id}
                          variant={
                            !comparisonMode && selectedArtifact?.id === a.id ? "default" : "outline"
                          }
                          size="sm"
                          onClick={() => {
                            setComparisonMode(false);
                            setSelectedArtifact(a);
                          }}
                          className="gap-1 text-xs"
                        >
                          <FileText className="h-3 w-3" />
                          {a.step_type.replace("_", " ")} — {a.artifact_kind}
                        </Button>
                      ))}
                      {canCompare && (
                        <Button
                          variant={comparisonMode ? "default" : "outline"}
                          size="sm"
                          onClick={() => setComparisonMode(!comparisonMode)}
                          className="gap-1 text-xs"
                        >
                          <Columns2 className="h-3 w-3" />
                          Compare ID & Selfie
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}

            {/* Evidence viewer */}
            {comparisonMode &&
              (() => {
                const idArtifact = getLatestArtifactForStep(metadata.artifacts, "id_doc");
                const selfieArtifact = getLatestArtifactForStep(metadata.artifacts, "selfie");

                return idArtifact && selfieArtifact ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <EvidenceViewer artifact={idArtifact} />
                    <EvidenceViewer artifact={selfieArtifact} />
                  </div>
                ) : null;
              })()}

            {!comparisonMode &&
              (selectedArtifact ? (
                <EvidenceViewer artifact={selectedArtifact} />
              ) : (
                <Card className="border-warm-200/70 dark:border-warm-700/70">
                  <CardContent className="flex flex-col items-center justify-center py-6 text-center">
                    <Eye className="h-8 w-8 text-muted-foreground/30" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      No artifact selected. Select a step or artifact to view evidence.
                    </p>
                  </CardContent>
                </Card>
              ))}

            {/* Metadata panel */}
            <EvidenceMetadataPanel
              step={selectedStep}
              artifact={selectedArtifact}
              providerResults={metadata.providerResults}
              accessLog={metadata.accessLog}
            />
          </div>
        </div>
      )}

      {!metadata && !loading && (
        <Card className="border-warm-200/70 dark:border-warm-700/70">
          <CardContent className="flex flex-col items-center justify-center py-6 text-center">
            <ShieldCheck className="h-8 w-8 text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">
              Enter a Step ID or User ID above to load verification evidence.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
