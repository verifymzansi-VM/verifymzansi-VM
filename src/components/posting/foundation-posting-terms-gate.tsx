"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PostingTermsAcceptance } from "./posting-terms-acceptance";
import {
  parseFoundationOwnerPostingTerms,
  type FoundationOwnerPostingTerms,
} from "@/lib/foundation/posting-terms";

function ActivePostingTermsGate({ children }: { children: ReactNode }) {
  const [document, setDocument] = useState<FoundationOwnerPostingTerms | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "signin">("loading");
  const load = useCallback(async (signal?: AbortSignal) => {
    setState("loading");
    try {
      const response = await fetch("/api/foundation/posting-terms", {
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (signal?.aborted) return;
      if (response.status === 401) {
        setState("signin");
        return;
      }
      if (!response.ok) throw new Error();
      const current = parseFoundationOwnerPostingTerms(await response.json());
      if (!current) throw new Error();
      if (signal?.aborted) return;
      setDocument(current);
      setState("ready");
    } catch {
      if (!signal?.aborted) setState("unavailable");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  if (state === "loading") return <p role="status">Checking posting terms…</p>;
  if (state === "signin")
    return (
      <p role="alert">
        <Link href="/login?returnUrl=%2Fpost%2Fcreate" className="underline">
          Sign in to continue posting
        </Link>
      </p>
    );
  if (state === "unavailable")
    return (
      <div className="space-y-3">
        <p role="alert">Posting terms are temporarily unavailable.</p>
        <Button type="button" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  if (document?.accepted_at) return <>{children}</>;
  return (
    <PostingTermsAcceptance
      document={document}
      onAccepted={setDocument}
      onRefresh={() => void load()}
    />
  );
}

export function FoundationPostingTermsGate({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return enabled ? <ActivePostingTermsGate>{children}</ActivePostingTermsGate> : <>{children}</>;
}
