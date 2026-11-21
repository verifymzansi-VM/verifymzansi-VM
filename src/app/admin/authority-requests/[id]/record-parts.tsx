"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Printer, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { AUTHORITY_REQUESTS_PATH, AUTHORITY_SELFIE_ENDPOINT } from "@/lib/admin/authority-requests";

/**
 * Closes the page when the record closes (15 minutes after it was opened):
 * the screen goes back to Authority requests, where opening it again is
 * logged again. The database refuses any later read on its own.
 */
export function RecordCloser({ closesAt }: { closesAt: string }) {
  const router = useRouter();
  useEffect(() => {
    const wait = Math.max(0, new Date(closesAt).getTime() - Date.now());
    const timer = window.setTimeout(
      () => router.replace(AUTHORITY_REQUESTS_PATH),
      Math.min(wait, 2147483647)
    );
    return () => window.clearTimeout(timer);
  }, [closesAt, router]);
  return null;
}

/** The selfie of one person the record names: fetched for this screen only
 * (each fetch is logged), never cached, removed when the page closes. */
export function DisclosureSelfie({
  disclosureId,
  subject,
  label,
}: {
  disclosureId: string;
  subject: string;
  label: string;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "shown"; url: string } | { status: "failed" }
  >({ status: "loading" });
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    fetch(AUTHORITY_SELFIE_ENDPOINT, {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ disclosureId, subject }),
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("selfie unavailable");
        url = URL.createObjectURL(await response.blob());
        if (cancelled) URL.revokeObjectURL(url);
        else setState({ status: "shown", url });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "failed" });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [disclosureId, subject]);
  return (
    <div className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-2xl border bg-muted">
      {state.status === "shown" ? (
        // A decrypted blob for this screen only; next/image cannot load it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={state.url} alt={label} className="h-full w-full object-contain" />
      ) : state.status === "loading" ? (
        <Loader2
          className="h-6 w-6 animate-spin text-muted-foreground"
          aria-label="Loading the selfie"
        />
      ) : (
        <div className="flex flex-col items-center gap-2 p-4 text-center text-sm text-muted-foreground">
          <UserRound className="h-12 w-12" aria-hidden="true" />
          The selfie could not be shown.
        </div>
      )}
    </div>
  );
}

/** Opens the print dialog (save as PDF there). */
export function PrintSheetButton() {
  return (
    <Button type="button" className="h-11 w-full px-5 sm:w-auto" onClick={() => window.print()}>
      <Printer className="h-4 w-4" />
      Print or save as PDF
    </Button>
  );
}
