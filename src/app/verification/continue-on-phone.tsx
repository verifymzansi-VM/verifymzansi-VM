"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, RefreshCw, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { StatusCallout, StepActions } from "./verification-ui";

export type HandoffDetails = { idNumber: string; firstName: string; lastName: string } | null;

type HandoffCode = { qr: { size: number; path: string }; expiresAt: string };

const POLL_MS = 4_000;
/** A code with less time left than this is not shown again. */
const MIN_LEFT_MS = 2 * 60_000;

/**
 * The last code made in this tab, for the same details: going Back and
 * choosing Continue on your phone again shows it instead of making a new link
 * (each new link counts against the limit of 5 an hour). New code makes one.
 */
let lastCode: { key: string; code: HandoffCode } | null = null;

/**
 * "Continue on your phone" on a computer without a usable camera (picture
 * 01d): a QR code for a single-use, 15-minute link made by the server for this
 * account only. The page checks the verification status itself and moves on
 * when the phone has sent the photos.
 */
export function ContinueOnPhonePanel({
  details,
  onBack,
  isDone,
  onDone,
}: {
  /** The names and ID number typed on this computer, or null for the selfie only. */
  details: HandoffDetails;
  onBack: () => void;
  /** Reads the verification status; true once the phone sent what was needed. */
  isDone: () => Promise<boolean>;
  onDone: () => void;
}) {
  const [code, setCode] = useState<HandoffCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);
  const started = useRef(false);

  const key = JSON.stringify(details);
  const makeCode = useCallback(
    async (reuse: boolean) => {
      if (
        reuse &&
        lastCode?.key === key &&
        Date.parse(lastCode.code.expiresAt) - Date.now() > MIN_LEFT_MS
      ) {
        setCode(lastCode.code);
        return;
      }
      setLoading(true);
      setError(null);
      setExpired(false);
      try {
        const response = await fetch("/api/verification/handoff", {
          method: "POST",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(details ?? {}),
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<HandoffCode> & {
          error?: string;
        };
        if (!response.ok || !payload.qr || !payload.expiresAt) {
          setCode(null);
          setError(payload.error ?? "We couldn't make a phone link right now. Please try again.");
          return;
        }
        const made = { qr: payload.qr, expiresAt: payload.expiresAt };
        lastCode = { key, code: made };
        setCode(made);
      } catch {
        setCode(null);
        setError("We couldn't make a phone link right now. Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    },
    [details, key]
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    queueMicrotask(() => void makeCode(true));
  }, [makeCode]);

  // Wait for the phone: the status updates once its photos arrive.
  useEffect(() => {
    if (!code) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (Date.parse(code.expiresAt) <= Date.now()) {
        setExpired(true);
        window.clearInterval(timer);
        return;
      }
      try {
        if ((await isDone()) && !stopped) {
          window.clearInterval(timer);
          onDone();
        }
      } catch {
        // Try again on the next tick.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [code, isDone, onDone]);

  return (
    <div className="space-y-4">
      {error && (
        <StatusCallout tone="attention">
          <p>{error}</p>
        </StatusCallout>
      )}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="flex h-44 w-44 shrink-0 items-center justify-center self-center rounded-2xl border border-border bg-white p-3 sm:self-start">
          {code && !expired ? (
            <svg
              viewBox={`0 0 ${code.qr.size} ${code.qr.size}`}
              className="h-full w-full"
              role="img"
              aria-label="QR code that opens this check on your phone"
              shapeRendering="crispEdges"
            >
              <rect width={code.qr.size} height={code.qr.size} fill="#fff" />
              <path d={code.qr.path} fill="#000" />
            </svg>
          ) : loading ? (
            <Loader2
              className="h-8 w-8 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-label="Making your code"
            />
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              {expired ? "This code has expired." : "No code yet."}
            </p>
          )}
        </div>
        <div className="min-w-0 space-y-3 text-sm leading-6">
          <p className="font-semibold text-foreground">Scan this with your phone&apos;s camera</p>
          <p className="text-muted-foreground">
            This computer has no camera we can use. Sign in on your phone with the same account,
            then take the photos. This page updates when you&apos;re done.
          </p>
          <p className="text-muted-foreground">
            No QR scanner? Sign in on your phone and open{" "}
            <span className="font-semibold text-foreground">Get verified</span>: your check carries
            on there.
          </p>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Works once, for 15 minutes, only for your account.
          </p>
          <p className="text-xs font-semibold text-foreground">Never send this code to anyone.</p>
        </div>
      </div>
      {code && !expired && (
        <p
          className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-sm text-foreground/85"
          role="status"
          aria-live="polite"
        >
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin text-brand-green-700 motion-reduce:animate-none dark:text-brand-gold-300"
            aria-hidden="true"
          />
          Waiting for your phone…
        </p>
      )}
      <StepActions>
        <Button variant="outline" size="lg" onClick={onBack} className="w-full sm:w-auto">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={() => void makeCode(false)}
          disabled={loading}
          className="w-full sm:w-auto"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          New code
        </Button>
      </StepActions>
    </div>
  );
}
