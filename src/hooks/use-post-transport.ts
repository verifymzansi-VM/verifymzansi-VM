"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseFoundationOwnerPostingTerms,
  type FoundationOwnerPostingTerms,
} from "@/lib/foundation/posting-terms";
type PostTransportFields = {
  postRequestId?: string;
  postingTerms?: { version: string; document_hash: string };
  expectedRevision?: number;
};

/** Hidden transport state for the existing forms. Consent identifies the terms
 * loaded for this form, and retries identify the same owner command. */
export function usePostTransport() {
  const receipt = useRef<string | null>(null);
  const revision = useRef<number | null>(null);
  const [terms, setTerms] = useState<FoundationOwnerPostingTerms | null>(null);
  useEffect(() => {
    receipt.current = crypto.randomUUID();
    const controller = new AbortController();
    void fetch("/api/foundation/posting-terms", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Posting terms unavailable");
        return response.json();
      })
      .then((value) => {
        const parsed = parseFoundationOwnerPostingTerms(value);
        if (!controller.signal.aborted) setTerms(parsed);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const captureRevision = useCallback((row: unknown) => {
    const value = row && typeof row === "object" ? (row as Record<string, unknown>).revision : null;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
      throw new Error("The post revision could not be loaded. Reopen it from your dashboard.");
    revision.current = value;
  }, []);
  const fields = useCallback(
    (editing = false): PostTransportFields => {
      if (!terms || !receipt.current)
        throw new Error("Posting terms are still loading. Refresh this form before submitting.");
      if (editing && revision.current === null)
        throw new Error("Reload your post before saving changes");
      return {
        postRequestId: receipt.current,
        postingTerms: { version: terms.version, document_hash: terms.document_hash },
        ...(editing ? { expectedRevision: revision.current! } : {}),
      };
    },
    [terms]
  );
  return { fields, captureRevision };
}
