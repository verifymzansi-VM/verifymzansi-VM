"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, ImageIcon, FileText, AlertTriangle, RefreshCw } from "lucide-react";
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

interface KycInlinePreviewProps {
  stepId: string;
  userId: string;
  stepType: string;
  /** Called with the fetched artifact when the user clicks the thumbnail */
  onClickPreview?: (artifact: Artifact) => void;
}

/**
 * Lazy-loaded inline thumbnail for a KYC artifact.
 * Uses IntersectionObserver to defer fetching until the card scrolls into view.
 * Fetches the first artifact for the step from the metadata endpoint,
 * then loads the decrypted blob via the evidence proxy.
 */
export function KycInlinePreview({
  stepId,
  userId,
  stepType,
  onClickPreview,
}: KycInlinePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  // IntersectionObserver — trigger load when card scrolls into viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fetch artifact metadata + blob once visible
  useEffect(() => {
    if (!isVisible || fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;

    async function loadThumbnail() {
      setLoading(true);
      setError(null);

      try {
        // 1. Fetch metadata to get artifact ID
        const metaParams = new URLSearchParams({
          stepId,
          userId,
        });
        const metaRes = await fetch(`/api/admin/verification/evidence/metadata?${metaParams}`);
        if (!metaRes.ok) {
          throw new Error("Failed to load metadata");
        }
        const meta = await metaRes.json();

        // Find matching artifact for this step type
        const artifacts: Artifact[] = meta.artifacts || [];
        const match = artifacts.find((a: Artifact) => a.step_type === stepType) || artifacts[0];

        if (!match) {
          if (!cancelled) setError("No document uploaded");
          return;
        }

        if (!cancelled) setArtifact(match);

        // 2. Fetch decrypted blob
        const evidenceRes = await fetch(`/api/admin/verification/evidence?artifactId=${match.id}`);
        if (!evidenceRes.ok) {
          throw new Error("Failed to load document");
        }
        const blob = await evidenceRes.blob();
        if (!cancelled) {
          const url = URL.createObjectURL(blob);
          setBlobUrl(url);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Load failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadThumbnail();

    return () => {
      cancelled = true;
    };
  }, [isVisible, stepId, userId, stepType]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const handleRetry = useCallback(() => {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }
    setArtifact(null);
    setError(null);
    fetchedRef.current = false;
    setIsVisible(true); // re-trigger fetch
  }, [blobUrl]);

  const handleClick = useCallback(() => {
    if (artifact && onClickPreview) {
      onClickPreview(artifact);
    }
  }, [artifact, onClickPreview]);

  const isImage = artifact?.content_type?.startsWith("image/");

  return (
    <div
      ref={containerRef}
      className="flex-shrink-0 w-[100px] h-[100px] rounded-lg border border-warm-200/70 bg-warm-50 overflow-hidden relative cursor-pointer group"
      onClick={handleClick}
      onContextMenu={(e) => e.preventDefault()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={`Preview ${stepType.replace("_", " ")} document`}
    >
      {/* Loading skeleton */}
      {loading && (
        <div className="flex items-center justify-center h-full w-full">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center h-full w-full p-2 text-center">
          {error === "No document uploaded" ? (
            <>
              <FileText className="h-5 w-5 text-muted-foreground/50" />
              <span className="text-[9px] text-muted-foreground mt-1 leading-tight">
                No document
              </span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-4 w-4 text-destructive/60" />
              <span className="text-[9px] text-destructive mt-1 leading-tight">{error}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 mt-1"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRetry();
                }}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      )}

      {/* Image thumbnail */}
      {blobUrl && !loading && !error && isImage && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={blobUrl}
            alt={`${stepType.replace("_", " ")} document thumbnail`}
            className="h-full w-full object-cover select-none"
            draggable={false}
          />
          {/* Mini watermark */}
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            aria-hidden="true"
          >
            <span className="select-none text-[8px] font-bold tracking-wide opacity-25 text-red-500 -rotate-[30deg] whitespace-nowrap">
              CONFIDENTIAL
            </span>
          </div>
          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <ImageIcon className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
          </div>
        </>
      )}

      {/* PDF thumbnail */}
      {blobUrl && !loading && !error && !isImage && (
        <div className="flex flex-col items-center justify-center h-full w-full">
          <FileText className="h-8 w-8 text-brand-blue/60" />
          <span className="text-[9px] text-muted-foreground mt-1">PDF</span>
          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <FileText className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
          </div>
        </div>
      )}

      {/* Not yet in viewport placeholder */}
      {!isVisible && !loading && !error && !blobUrl && (
        <div className="flex items-center justify-center h-full w-full">
          <ImageIcon className="h-5 w-5 text-muted-foreground/30" />
        </div>
      )}

      {/* Print protection */}
      <style>{`
        @media print {
          .evidence-protected, [data-evidence-thumb] {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
