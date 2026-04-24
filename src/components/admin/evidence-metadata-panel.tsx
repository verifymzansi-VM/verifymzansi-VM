"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info, Shield, Clock, User } from "lucide-react";
import type { AccessLog, Artifact, EvidenceStep, ProviderResult } from "./evidence-types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EvidenceMetadataPanel({
  step,
  artifact,
  providerResults,
  accessLog,
}: {
  step: EvidenceStep | null;
  artifact: Artifact | null;
  providerResults: ProviderResult[];
  accessLog: AccessLog[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Step metadata */}
      {step && (
        <Card className="border-warm-200/70 dark:border-warm-700/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Info className="h-4 w-4 text-muted-foreground" />
              Step Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <Row label="Step ID" value={step.id} mono />
            <Row label="Type" value={step.step_type.replace("_", " ")} />
            {step.step_type === "id_doc" && step.first_name && (
              <Row label="First Name" value={step.first_name} />
            )}
            {step.step_type === "id_doc" && step.last_name && (
              <Row label="Surname" value={step.last_name} />
            )}
            <Row label="Status" value={step.status} />
            <Row label="Submitted" value={formatDate(step.created_at)} dateTime={step.created_at} />
            {step.risk_level && <Row label="Risk Level" value={step.risk_level} />}
            {step.risk_score !== null && <Row label="Risk Score" value={String(step.risk_score)} />}
            {step.auto_status && <Row label="Auto Status" value={step.auto_status} />}
            {step.location_method && <Row label="Location Method" value={step.location_method} />}
            {(step.location_city || step.location_province) && (
              <Row
                label="Resolved Area"
                value={[step.location_city, step.location_province].filter(Boolean).join(", ")}
              />
            )}
            {step.location_address_line && (
              <Row label="Proof Address" value={step.location_address_line} />
            )}
            {step.gps_lat !== null && step.gps_lon !== null && (
              <Row label="GPS Coords" value={`${step.gps_lat}, ${step.gps_lon}`} />
            )}
            {step.reason_code && <Row label="Reason Code" value={step.reason_code} />}
            {step.reviewed_by && <Row label="Reviewed By" value={step.reviewed_by} mono />}
            {step.reviewed_at && (
              <Row
                label="Reviewed At"
                value={formatDate(step.reviewed_at)}
                dateTime={step.reviewed_at}
              />
            )}
            {step.metadata && Object.keys(step.metadata).length > 0 && (
              <div className="pt-1">
                <p className="mb-1 font-medium text-muted-foreground">Metadata</p>
                <pre className="max-h-32 overflow-auto rounded bg-warm-50 p-2 text-[10px] dark:bg-muted">
                  {JSON.stringify(step.metadata, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Artifact metadata */}
      {artifact && (
        <Card className="border-warm-200/70 dark:border-warm-700/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Shield className="h-4 w-4 text-muted-foreground" />
              Artifact Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <Row label="Artifact ID" value={artifact.id} mono />
            <Row label="Step Type" value={artifact.step_type.replace("_", " ")} />
            <Row label="Kind" value={artifact.artifact_kind} />
            <Row label="MIME" value={artifact.content_type} />
            <Row label="Size" value={formatBytes(artifact.file_size_bytes)} />
            <Row label="Status" value={artifact.status} />
            <Row
              label="Uploaded"
              value={formatDate(artifact.created_at)}
              dateTime={artifact.created_at}
            />
            {artifact.purge_after && (
              <Row
                label="Purge After"
                value={formatDate(artifact.purge_after)}
                dateTime={artifact.purge_after}
              />
            )}
            {artifact.sha256 && <Row label="SHA-256" value={artifact.sha256} mono />}
            <Row label="R2 Key" value={artifact.r2_key} mono />
          </CardContent>
        </Card>
      )}

      {/* Provider results */}
      {providerResults.length > 0 && (
        <Card className="border-warm-200/70 dark:border-warm-700/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Shield className="h-4 w-4 text-brand-blue" />
              Provider Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {providerResults.map((pr) => (
              <div
                key={pr.id}
                className="rounded-md border border-warm-200/70 dark:border-warm-700/70 p-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{pr.provider_name}</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      pr.normalized_decision === "approved"
                        ? "border-brand-green/40 text-brand-green"
                        : pr.normalized_decision === "rejected"
                          ? "border-destructive/40 text-destructive"
                          : "border-amber-400/40 text-amber-600"
                    }`}
                  >
                    {pr.normalized_decision}
                  </Badge>
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  {pr.check_type} — Raw: {pr.raw_status}
                </p>
                <p className="text-muted-foreground">
                  <time dateTime={pr.created_at}>{formatDate(pr.created_at)}</time>
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Access log */}
      {accessLog.length > 0 && (
        <Card className="border-warm-200/70 dark:border-warm-700/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Recent Access Log
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-40 space-y-1 overflow-auto text-xs">
              {accessLog.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between border-b border-warm-100 dark:border-warm-800 py-1 last:border-0"
                >
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <User className="h-3 w-3" />
                    {log.actor_id.slice(0, 8)}…
                  </span>
                  <time dateTime={log.accessed_at} className="text-muted-foreground">
                    {formatDate(log.accessed_at)}
                  </time>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function Row({
  label,
  value,
  mono,
  dateTime,
}: {
  label: string;
  value: string;
  mono?: boolean;
  dateTime?: string;
}) {
  const content = dateTime ? <time dateTime={dateTime}>{value}</time> : value;
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`text-right break-all ${mono ? "font-mono text-[10px]" : ""}`}>
        {content}
      </span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
