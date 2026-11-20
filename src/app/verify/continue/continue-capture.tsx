"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, IdCard, Loader2, Monitor, ScanFace, Timer } from "lucide-react";
import { Header } from "@/components/layout/header";
import { CameraCapture } from "@/components/ui/camera-capture";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { StatusCallout, StepCard } from "@/app/verification/verification-ui";

type PhoneView = {
  publicName: string;
  expiresAt: string;
  needsId: boolean;
  needsSelfie: boolean;
};
type Stage =
  | { kind: "loading" }
  | { kind: "sign_in" }
  | { kind: "problem"; message: string }
  | { kind: "ready"; view: PhoneView };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** Where the link's token waits while the member signs in on this phone (this
 * tab only; it never goes into a URL). */
const PENDING_TOKEN_KEY = "vm_handoff_pending_token";
const SIGN_IN_HREF = `/login?returnUrl=${encodeURIComponent("/verify/continue")}`;

function readPendingToken() {
  try {
    return window.sessionStorage.getItem(PENDING_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}
function keepPendingToken(token: string | null) {
  try {
    if (token) window.sessionStorage.setItem(PENDING_TOKEN_KEY, token);
    else window.sessionStorage.removeItem(PENDING_TOKEN_KEY);
  } catch {
    // Without storage the member scans the code again after signing in.
  }
}

/** A capture token for a camera that starts now on this phone. */
async function requestPhoneCaptureToken(kind: "id_front" | "selfie") {
  const response = await fetch("/api/handoff/capture-token", {
    method: "POST",
    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ kind }),
  });
  const payload = (await response.json().catch(() => ({}))) as { token?: string };
  return response.ok && typeof payload.token === "string" ? payload.token : null;
}
const UNAVAILABLE =
  "This link has expired or was already used. On your computer, choose New code and scan it again.";

async function readView(response: Response): Promise<PhoneView | { error: string; code?: string }> {
  const payload = (await response.json().catch(() => ({}))) as Partial<PhoneView> & {
    error?: string;
    code?: string;
  };
  if (!response.ok || typeof payload.publicName !== "string" || !payload.expiresAt)
    return { error: payload.error ?? UNAVAILABLE, code: payload.code };
  return {
    publicName: payload.publicName,
    expiresAt: payload.expiresAt,
    needsId: Boolean(payload.needsId),
    needsSelfie: Boolean(payload.needsSelfie),
  };
}

/**
 * The phone side of "Continue on your phone" (picture 01d, phone). The phone
 * must be signed in as the same account (owner decision): a signed-out phone
 * is sent to sign in first, with the link's token kept in this tab's session
 * storage (never in a URL), and comes back here. The token comes from the
 * link's #fragment and is sent once; the server then keeps a capture grant in
 * an HttpOnly cookie that only allows taking this check's photos.
 */
export function ContinueCapture() {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    const fromLink = window.location.hash.slice(1);
    // The token is used once; it never stays in the address bar or history.
    if (fromLink) window.history.replaceState(null, "", window.location.pathname);
    const token = TOKEN.test(fromLink) ? fromLink : readPendingToken();
    void (async () => {
      try {
        const response = TOKEN.test(token)
          ? await fetch("/api/handoff/open", {
              method: "POST",
              headers: withCsrfHeaders({ "Content-Type": "application/json" }),
              body: JSON.stringify({ token }),
            })
          : await fetch("/api/handoff/state", { cache: "no-store" });
        const view = await readView(response);
        if ("error" in view && view.code === "handoff_sign_in_required" && TOKEN.test(token)) {
          keepPendingToken(token);
          setStage({ kind: "sign_in" });
          return;
        }
        // Used, refused or done with: it is not kept.
        keepPendingToken(null);
        setStage(
          "error" in view ? { kind: "problem", message: view.error } : { kind: "ready", view }
        );
      } catch {
        setStage({
          kind: "problem",
          message: "We couldn't open this link. Check your connection and scan the code again.",
        });
      }
    })();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const send = useCallback(
    async (
      file: File,
      docType: "id_document" | "selfie",
      captureToken: string | undefined,
      livenessPassed?: boolean
    ) => {
      setSending(true);
      setSendError(null);
      const requestId = crypto.randomUUID();
      const attempt = async () => {
        const form = new FormData();
        form.append("file", file);
        form.append("docType", docType);
        form.append("uploadRequestId", requestId);
        form.append("captureMethod", "camera");
        if (docType === "selfie") form.append("livenessPassed", livenessPassed ? "true" : "false");
        if (captureToken) form.append("captureToken", captureToken);
        return fetch("/api/handoff/upload", {
          method: "POST",
          headers: withCsrfHeaders(),
          body: form,
        });
      };
      try {
        let response = await attempt();
        // One retry for a dropped connection or a busy server (same request id).
        if (response.status === 503) response = await attempt();
        const payload = (await response.json().catch(() => ({}))) as Partial<PhoneView> & {
          error?: string;
          code?: string;
        };
        if (!response.ok) {
          if (payload.code === "handoff_unavailable" || payload.code === "handoff_sign_in_required")
            setStage({ kind: "problem", message: payload.error ?? UNAVAILABLE });
          else setSendError(payload.error ?? "Your photo wasn't sent. Please take it again.");
          return;
        }
        setStage((current) =>
          current.kind === "ready"
            ? {
                kind: "ready",
                view: {
                  ...current.view,
                  needsId: Boolean(payload.needsId),
                  needsSelfie: Boolean(payload.needsSelfie),
                },
              }
            : current
        );
      } catch {
        setSendError("Your photo wasn't sent. Check your connection and take it again.");
      } finally {
        setSending(false);
      }
    },
    []
  );

  const view = stage.kind === "ready" ? stage.view : null;
  const done = view ? !view.needsId && !view.needsSelfie : false;
  const left = view ? Math.max(0, Math.ceil((Date.parse(view.expiresAt) - now) / 60_000)) : 0;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="flex-1">
        <div className="container-page py-5 sm:py-8">
          <div className="mx-auto w-full max-w-xl space-y-5">
            {stage.kind === "loading" && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                Opening your check…
              </p>
            )}
            {stage.kind === "sign_in" && (
              <StepCard
                id="continue-capture-sign-in"
                stepNumber={2}
                title="Sign in on this phone"
                icon={Monitor}
                why="Your photos go straight from your phone to us."
              >
                <p className="text-sm leading-6 text-muted-foreground">
                  Sign in on your phone with the same account, then take the photos. You&apos;ll
                  come back here after signing in.
                </p>
                <Button asChild variant="trust-verified" size="lg" className="w-full">
                  <Link href={SIGN_IN_HREF}>Sign in</Link>
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  Didn&apos;t start this yourself? Close this page. Nothing is shared.
                </p>
              </StepCard>
            )}
            {stage.kind === "problem" && (
              <StatusCallout tone="attention" title="This link can't be used">
                <p>{stage.message}</p>
              </StatusCallout>
            )}
            {view && (
              <StepCard
                id="continue-capture-step"
                stepNumber={view.needsId ? 2 : 3}
                title={view.needsId ? "ID details" : "Selfie check"}
                icon={view.needsId ? IdCard : ScanFace}
                why={
                  view.needsId
                    ? "Encrypted, and never shown publicly."
                    : "Matched to your ID photo. Only our review team sees it."
                }
              >
                <div className="flex items-start gap-3 rounded-2xl border border-brand-green-600/20 bg-brand-green-50 p-4 text-brand-green-900 dark:border-brand-green-400/20 dark:bg-brand-green-500/10 dark:text-brand-gold-100">
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-green-600/10"
                  >
                    <Monitor className="h-4 w-4" />
                  </span>
                  <div className="space-y-1 text-sm leading-6">
                    <p className="font-semibold">Continuing your check from a computer.</p>
                    <p>
                      You&apos;re adding ID photos for{" "}
                      <span className="font-semibold">{view.publicName}</span>
                    </p>
                  </div>
                </div>
                {done ? (
                  <StatusCallout tone="success" icon={CheckCircle2} title="All done">
                    <p>
                      Your photos are with us. Go back to your computer: it updates by itself. You
                      can close this page.
                    </p>
                  </StatusCallout>
                ) : (
                  <>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Take the photos on this phone. When you&apos;re done, go back to your
                      computer: it updates by itself.
                    </p>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {left > 0
                        ? `This link works once and expires in ${left} minute${left === 1 ? "" : "s"}.`
                        : "This link has expired."}
                    </p>
                    {sendError && (
                      <p role="alert" className="inline-form-error">
                        {sendError}
                      </p>
                    )}
                    {sending ? (
                      <p role="status" className="flex items-center gap-2 text-sm">
                        <Loader2
                          className="h-4 w-4 animate-spin motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                        Sending your photo…
                      </p>
                    ) : view.needsId ? (
                      <CameraCapture
                        key="id"
                        facingMode="environment"
                        telemetryContext="handoff_id_doc"
                        documentGuide
                        getCaptureToken={() => requestPhoneCaptureToken("id_front")}
                        onCapture={(file, meta) =>
                          void send(file, "id_document", meta?.captureToken)
                        }
                      />
                    ) : (
                      <CameraCapture
                        key="selfie"
                        facingMode="user"
                        telemetryContext="handoff_selfie"
                        requireLiveness
                        getCaptureToken={() => requestPhoneCaptureToken("selfie")}
                        onCapture={(file, meta) =>
                          void send(
                            file,
                            "selfie",
                            meta?.captureToken,
                            meta?.livenessPassed ?? false
                          )
                        }
                      />
                    )}
                  </>
                )}
                <p className="text-xs leading-5 text-muted-foreground">
                  Didn&apos;t start this yourself? Close this page. Nothing is shared.
                </p>
              </StepCard>
            )}
            {stage.kind === "problem" && (
              <Button asChild variant="outline" size="lg" className="w-full">
                <Link href="/verification">Open Get verified on this phone</Link>
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
