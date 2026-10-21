"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import {
  parseFoundationOwnerPostingTerms,
  type FoundationOwnerPostingTerms,
} from "@/lib/foundation/posting-terms";

type Consent = { version: string; document_hash: string; accepted: true };
async function recordAcceptance(input: Consent) {
  const response = await fetch("/api/foundation/posting-terms", {
    method: "POST",
    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error("Acceptance unavailable");
  const receipt = parseFoundationOwnerPostingTerms(await response.json());
  if (
    !receipt ||
    !receipt.accepted_at ||
    receipt.version !== input.version ||
    receipt.document_hash !== input.document_hash
  )
    throw new Error("Acceptance not confirmed");
  return receipt;
}

export function PostingTermsAcceptance({
  document,
  onAccepted,
  onRefresh,
  accept = recordAcceptance,
}: {
  document: FoundationOwnerPostingTerms | null;
  onAccepted: (receipt: FoundationOwnerPostingTerms) => void;
  onRefresh?: () => void;
  accept?: (input: Consent) => Promise<FoundationOwnerPostingTerms>;
}) {
  const id = useId();
  const key = document ? `${document.version}:${document.document_hash}` : null;
  const currentKey = useRef(key);
  currentKey.current = key;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [choice, setChoice] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<FoundationOwnerPostingTerms | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const accepted =
    document?.accepted_at ||
    (receipt?.version === document?.version &&
      receipt?.document_hash === document?.document_hash &&
      receipt?.accepted_at);
  const checked = key !== null && choice === key;
  const busy = key !== null && pending === key;
  async function submit() {
    if (!document || !key || !checked || busy) return;
    const displayed = document;
    setPending(key);
    setFailure(null);
    try {
      const result = await accept({
        version: displayed.version,
        document_hash: displayed.document_hash,
        accepted: true,
      });
      if (!mounted.current || currentKey.current !== key) return;
      const parsed = parseFoundationOwnerPostingTerms(result);
      if (
        !parsed?.accepted_at ||
        parsed.version !== displayed.version ||
        parsed.document_hash !== displayed.document_hash
      )
        throw new Error("Acceptance not confirmed");
      setReceipt(parsed);
      onAccepted(parsed);
    } catch {
      if (mounted.current && currentKey.current === key) setFailure(key);
    } finally {
      if (mounted.current && currentKey.current === key) setPending(null);
    }
  }
  if (!document)
    return <p role="alert">Posting terms are currently unavailable. Please try again later.</p>;
  return (
    <section aria-label="Posting terms" className="space-y-3 rounded-xl border p-4">
      <a
        href={document.document_path}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm underline"
      >
        Read posting terms
      </a>
      {accepted ? (
        <p role="status" className="text-sm">
          You’ve accepted the current posting terms.
        </p>
      ) : (
        <>
          <label htmlFor={id} className="flex items-start gap-3 text-sm">
            <input
              id={id}
              type="checkbox"
              checked={checked}
              disabled={busy}
              onChange={(event) => setChoice(event.target.checked ? key : null)}
              className="mt-1 h-4 w-4"
            />
            I agree to the current posting terms.
          </label>
          <Button type="button" disabled={!checked || busy} onClick={submit}>
            {busy ? "Recording acceptance…" : "Accept posting terms"}
          </Button>
          {failure === key && (
            <div className="space-y-2">
              <p role="alert" className="text-sm">
                We couldn’t confirm your acceptance. Review the current terms and try again.
              </p>
              {onRefresh && (
                <Button type="button" variant="outline" onClick={onRefresh}>
                  Check current terms
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
