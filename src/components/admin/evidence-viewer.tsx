"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Eye, FileText, ImageIcon, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EvidenceViewer({ artifact }: { artifact: Artifact }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch decrypted evidence via server proxy
  useEffect(() => {
    let cancelled = false;

    async function loadEvidence() {
      setLoading(true);
      setError(null);
      setBlobUrl(null);

      try {
        const params = new URLSearchParams({
          artifactId: artifact.id,
        });
        const res = await fetch(`/api/admin/verification/evidence?${params}`);
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
          setError(err instanceof Error ? err.message : "Failed to load evidence");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadEvidence();

    return () => {
      cancelled = true;
      // Revoke previous blob URL
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [artifact.id]);

  const isImage = artifact.content_type.startsWith("image/");
  const isPdf = artifact.content_type === "application/pdf";

  // Prevent right-click context menu on evidence content
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Revoke blob on visibility change (tab switch / screenshot attempt)
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden && blobUrl) {
        URL.revokeObjectURL(blobUrl);
        setBlobUrl(null);
        setError("Evidence cleared for security. Click Retry to reload.");
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [blobUrl]);

  const watermarkText = `CONFIDENTIAL — ${new Date().toISOString().slice(0, 16)}`;

  return (
    <Card className="border-warm-200/70 dark:border-warm-700/70">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Eye className="h-4 w-4 text-brand-blue" />
            Evidence Viewer
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {isImage ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
            <span>
              {artifact.step_type} — {artifact.artifact_kind}
            </span>
            <span>({formatBytes(artifact.file_size_bytes)})</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Decrypting and loading evidence…
            </span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-6">
            <AlertTriangle className="h-8 w-8 text-destructive/60" />
            <p className="mt-2 text-sm text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                // Revoke old blob URL if any to prevent leak
                if (blobUrl) {
                  URL.revokeObjectURL(blobUrl);
                  setBlobUrl(null);
                }
                // Trigger re-fetch
                setLoading(true);
                setError(null);
                const params = new URLSearchParams({
                  artifactId: artifact.id,
                  r2Key: artifact.r2_key,
                });
                fetch(`/api/admin/verification/evidence?${params}`)
                  .then((res) => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return res.blob();
                  })
                  .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    setBlobUrl(url);
                    setLoading(false);
                  })
                  .catch((err) => {
                    setError(err instanceof Error ? err.message : "Retry failed");
                    setLoading(false);
                  });
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {blobUrl && !loading && !error && (
          <div className="space-y-3 evidence-protected" onContextMenu={handleContextMenu}>
            {isImage && (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={blobUrl}
                  alt={`Evidence: ${artifact.step_type}`}
                  className="max-h-[500px] w-full rounded-md border border-warm-200/70 dark:border-warm-700/70 object-contain bg-warm-50 dark:bg-warm-900 select-none"
                  draggable={false}
                />
                {/* Watermark overlay */}
                <div
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                  aria-hidden="true"
                >
                  <span className="select-none text-2xl font-bold tracking-widest opacity-20 text-red-500 -rotate-[30deg] whitespace-nowrap [text-shadow:0_0_4px_rgba(0,0,0,0.1)]">
                    {watermarkText}
                  </span>
                </div>
              </div>
            )}

            {isPdf && (
              <div className="relative">
                <iframe
                  src={blobUrl}
                  title={`Evidence: ${artifact.step_type}`}
                  className="h-[500px] w-full rounded-md border border-warm-200/70 dark:border-warm-700/70"
                />
                {/* Watermark overlay for PDF */}
                <div
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                  aria-hidden="true"
                >
                  <span className="select-none text-2xl font-bold tracking-widest opacity-20 text-red-500 -rotate-[30deg] whitespace-nowrap [text-shadow:0_0_4px_rgba(0,0,0,0.1)]">
                    {watermarkText}
                  </span>
                </div>
              </div>
            )}

            {!isImage && !isPdf && (
              <div className="flex flex-col items-center justify-center rounded-md border border-warm-200/70 dark:border-warm-700/70 bg-warm-50 dark:bg-warm-900 py-6">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">
                  Preview not available for {artifact.content_type}
                </p>
              </div>
            )}

            {/* Print-media CSS hiding — moved to globals.css for CSP nonce compliance */}

            {/* Purge warning */}
            {artifact.purge_after && (
              <div className="flex items-center gap-2 rounded-md border border-amber-300/60 dark:border-amber-600/30 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Scheduled for purge:{" "}
                <time dateTime={artifact.purge_after}>
                  {new Date(artifact.purge_after).toLocaleDateString("en-ZA")}
                </time>
              </div>
            )}

            {/* Security notice */}
            <p className="text-[10px] text-muted-foreground">
              This content was decrypted server-side and is displayed in-memory only. Do not
              screenshot or download evidence outside of authorised review.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
