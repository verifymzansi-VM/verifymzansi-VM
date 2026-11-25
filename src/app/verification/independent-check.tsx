"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ChevronRight,
  History,
  IdCard,
  Loader2,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { isIdentityCheckFrameMessage } from "@/lib/verification/identity-check-frame";
import {
  DIDIT_END_USER_TERMS_URL,
  DIDIT_PRIVACY_NOTICE_URL,
  IDENTITY_CHECK_CONSENT_VERSION,
} from "@/lib/verification/identity-check-consent";
import {
  IDENTITY_CHECK_POLL_MS,
  formatAskByDate,
  identityCheckAvailabilitySchema,
  identityCheckWaiting,
  type DeclineReason,
  type IdentityCheckAvailability,
  type IdentityCheckView,
} from "@/lib/verification/identity-check-view";
import { FieldGroupHeading, StatusCallout, StepActions } from "./verification-ui";

/**
 * The independent ID check on the ID step of Get verified (Didit plan,
 * section 3, pictures 02 to 08). Shown only when the staff setting sends
 * checks to Didit; on "manual" the step is the camera route members see
 * today.
 */

const LINK =
  "font-semibold text-brand-green-700 underline underline-offset-2 dark:text-brand-gold-300";

/**
 * The member's route and latest check, read when the ID step opens and every
 * 15 seconds while a check waits for its result (only while the page is
 * visible). `undefined` until the first answer; a failed read keeps the last
 * good answer, and with none the step is the camera route (null).
 */
export function useIdentityCheck(active: boolean) {
  const [availability, setAvailability] = useState<IdentityCheckAvailability | null | undefined>(
    undefined
  );
  const keep = useCallback(
    (next: IdentityCheckAvailability | null) =>
      setAvailability((previous) => next ?? previous ?? null),
    []
  );
  const refresh = useCallback(async () => {
    const next = await readIdentityCheck();
    keep(next);
    return next;
  }, [keep]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    async function load() {
      const next = await readIdentityCheck();
      if (!cancelled) keep(next);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [active, keep]);
  return { availability, refresh };
}

async function readIdentityCheck(): Promise<IdentityCheckAvailability | null> {
  try {
    const res = await fetch("/api/verification/identity-check", { cache: "no-store" });
    const parsed = identityCheckAvailabilitySchema.safeParse(res.ok ? await res.json() : null);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The query marker of the one reload below. */
const RELOAD_MARK = "check-reload";

/** Whether this document was loaded at /verification; null when the browser
 * cannot tell. */
function loadedAtVerification(): boolean | null {
  try {
    const entry = performance.getEntriesByType("navigation")[0];
    return entry ? new URL(entry.name).pathname === "/verification" : null;
  } catch {
    return null;
  }
}

/**
 * The check's frame and camera rules come only with a document load of
 * /verification (src/lib/middleware/security-headers.ts), and a page's rules
 * stay those of the document it was loaded as. After an in-app link to Get
 * verified the frame would be refused, so before anything starts (and before
 * an unfinished check is shown) the page loads itself once more, with a query
 * marker so it never loops. "blocked" (still not a document load after that
 * reload) keeps the check closed.
 */
export function useCheckDocument(active: boolean): "ready" | "reloading" | "blocked" {
  const [loaded] = useState(() => (typeof window === "undefined" ? null : loadedAtVerification()));
  const [marked] = useState(
    () =>
      typeof window !== "undefined" && new URL(window.location.href).searchParams.has(RELOAD_MARK)
  );
  useEffect(() => {
    if (!active || loaded !== false || marked) return;
    const url = new URL(window.location.href);
    url.searchParams.set(RELOAD_MARK, "1");
    window.location.replace(url.toString());
  }, [active, loaded, marked]);
  if (!active || loaded !== false) return "ready";
  return marked ? "blocked" : "reloading";
}

/** While the step's route is read, or the page loads itself again. */
export function IndependentCheckLoading({ blocked = false }: { blocked?: boolean }) {
  return blocked ? (
    <StatusCallout tone="attention" role="alert">
      <p>The ID check couldn&apos;t open on this page. Reload the page, then try again.</p>
    </StatusCallout>
  ) : (
    <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      Loading the ID step…
    </p>
  );
}

/** Asks for the result every 15 seconds while `waiting`, only while visible. */
export function useIdentityCheckPolling(
  view: IdentityCheckView | null,
  refresh: () => Promise<unknown>
) {
  const waiting = identityCheckWaiting(view);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, IDENTITY_CHECK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, refresh]);
}

/* ── 02: start ─────────────────────────────────────────────────────────── */

function InfoRow({ icon: Icon, children }: { icon: typeof IdCard; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm leading-6 text-foreground/85">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/70"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="pt-1">{children}</span>
    </li>
  );
}

export function IndependentCheckStart({
  namesReady,
  firstName,
  lastName,
  disabled,
  onStarted,
  onBack,
}: {
  namesReady: boolean;
  firstName: string;
  lastName: string;
  disabled: boolean;
  onStarted: () => Promise<unknown>;
  onBack: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/verification/identity-check", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          consent: agreed,
          consentVersion: IDENTITY_CHECK_CONSENT_VERSION,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setError(payload.error || "The ID check didn't start. Please try again.");
        return;
      }
      await onStarted();
    } catch {
      setError("The ID check didn't start. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <div className="space-y-3">
        <FieldGroupHeading title="Our independent verification system will ask you to" />
        <ul className="space-y-2.5">
          <InfoRow icon={IdCard}>
            Photograph your SA ID card or green ID book with your camera
          </InfoRow>
          <InfoRow icon={ScanFace}>
            Record a short selfie video, to check it&apos;s really you
          </InfoRow>
        </ul>
      </div>
      <div className="space-y-3">
        <FieldGroupHeading title="Your data" />
        <ul className="space-y-2.5">
          <InfoRow icon={ShieldCheck}>
            It runs inside this page and receives no name, email or phone number.
          </InfoRow>
          <InfoRow icon={History}>It deletes its copy of your ID photo after 1 month.</InfoRow>
        </ul>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-border/80 bg-muted/40 p-3.5">
        <input
          type="checkbox"
          id="identity-check-consent"
          checked={agreed}
          disabled={disabled || starting}
          onChange={(event) => setAgreed(event.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 cursor-pointer rounded border-input accent-brand-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:accent-brand-green-400"
        />
        <Label
          htmlFor="identity-check-consent"
          className="cursor-pointer text-sm font-normal leading-6 text-foreground/85"
        >
          I agree that VerifyMzansi asks Didit, our independent verification partner, to check my ID
          and my face, with my data held in Ireland (European Union) and some of Didit&apos;s
          providers in the United States, as described in the{" "}
          <Link href="/privacy" prefetch={false} target="_blank" rel="noopener" className={LINK}>
            privacy policy
          </Link>
          , Didit&apos;s{" "}
          <a
            href={DIDIT_PRIVACY_NOTICE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK}
          >
            Verification Privacy Notice
          </a>{" "}
          and its{" "}
          <a
            href={DIDIT_END_USER_TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK}
          >
            End User Terms
          </a>
          .
        </Label>
      </div>
      {error && (
        <p className="inline-form-error" role="alert">
          {error}
        </p>
      )}
      <StepActions>
        <Button variant="outline" size="lg" onClick={onBack} className="w-full sm:w-auto">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        <Button
          onClick={() => void start()}
          disabled={!agreed || !namesReady || disabled || starting}
          variant="trust-verified"
          size="lg"
          className="w-full sm:w-auto sm:min-w-40"
        >
          {starting ? (
            <Loader2
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <ScanFace className="h-4 w-4" aria-hidden="true" />
          )}
          Start ID check
        </Button>
      </StepActions>
      <p className="text-center text-xs leading-5 text-muted-foreground">
        The check opens in this page and uses your camera only. Use your phone if you can.
      </p>
    </>
  );
}

/* ── 02b: the check in the page ───────────────────────────────────────── */

/** The frame's own messages are hints for the screen only: the server
 * fetches the result itself. */
function frameEvent(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const value =
      (data as { type?: unknown; event?: unknown }).type ?? (data as { event?: unknown }).event;
    return typeof value === "string" ? value : null;
  }
  return null;
}

export function IndependentCheckFrame({
  url,
  onFinished,
}: {
  url: string;
  onFinished: () => void;
}) {
  useEffect(() => {
    function listen(event: MessageEvent) {
      if (!isIdentityCheckFrameMessage(event)) return;
      if (frameEvent(event.data) === "didit:completed") onFinished();
    }
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [onFinished]);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <iframe
        src={url}
        title="Independent ID check"
        allow="camera"
        className="block h-[640px] max-h-[80vh] w-full border-0"
      />
    </div>
  );
}

/* ── 03: checking ─────────────────────────────────────────────────────── */

export function IndependentCheckChecking() {
  return (
    <div role="status" className="space-y-3 px-2 py-6 text-center">
      <span
        aria-hidden="true"
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-green-600/10 text-brand-green-700 dark:bg-brand-green-400/15 dark:text-brand-gold-300"
      >
        <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" />
      </span>
      <h3 className="font-display text-2xl font-bold text-foreground">Checking your ID</h3>
      <p className="text-sm leading-6 text-muted-foreground">
        We have your photos. This usually takes less than a minute, and this page updates by itself.
      </p>
      <p className="text-xs leading-5 text-muted-foreground">
        You can close this page. We&apos;ll show the result here.
      </p>
    </div>
  );
}

/* ── 04 and 05: results that move on to the location step ─────────────── */

function ContinueButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="border-t border-border/60 pt-4">
      <Button variant="trust-verified" size="lg" className="w-full" onClick={onClick}>
        {label}
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

export function IndependentCheckApproved({
  fullName,
  publicName,
  onContinue,
}: {
  fullName: string | null;
  publicName: string | null;
  onContinue: () => void;
}) {
  return (
    <>
      <StatusCallout tone="success" title="Your ID is verified." role="status">
        {fullName ? (
          <p>
            Your name on VerifyMzansi is now <strong>{fullName}</strong>, exactly as on your ID. It
            can&apos;t be changed later.{publicName ? ` Buyers see “${publicName}”.` : ""}
          </p>
        ) : (
          <p>
            Your name on VerifyMzansi is now exactly as on your ID. It can&apos;t be changed later.
          </p>
        )}
      </StatusCallout>
      <ContinueButton label="Continue to location" onClick={onContinue} />
    </>
  );
}

export function IndependentCheckWithStaff({ onContinue }: { onContinue: () => void }) {
  return (
    <>
      <StatusCallout
        tone="pending"
        icon={UserCheck}
        title="A person will check your ID."
        role="status"
      >
        <p>
          The automatic check couldn&apos;t confirm everything, so one of our team will look at your
          photos. This usually takes 1–2 working days. We&apos;ll notify you; you don&apos;t need to
          do anything.
        </p>
      </StatusCallout>
      <ContinueButton label="Meanwhile, add your location" onClick={onContinue} />
    </>
  );
}

/* ── 06 and 07: a fully automatic decline ─────────────────────────────── */

const DECLINE_TEXT: Record<DeclineReason, { text: string; tip: string }> = {
  names_differ: {
    text: "The names you typed don't match the names on your ID.",
    tip: "Tip: type every first name and your surname exactly as on your ID.",
  },
  id_unreadable: {
    text: "Your ID or its ID number couldn't be read.",
    tip: "Tip: photograph the ID in good light, with all four corners in view and no glare.",
  },
  under_18: {
    text: "You need to be 18 or older to be verified.",
    tip: "If your ID shows you are 18 or older, ask a person to look again.",
  },
  photo_not_matched: {
    text: "The automatic check couldn't confirm that the ID, your selfie and the names you typed belong together.",
    tip: "Tip: type every first name exactly as on your ID, and photograph the ID in good light with no glare.",
  },
  not_confirmed: {
    text: "The automatic check couldn't confirm your ID.",
    tip: "If you think this is wrong, ask a person to look again.",
  },
};

const ASK_NOTE = { min: 20, max: 2000 } as const;

function AskPersonForm({
  checkId,
  askBy,
  onSent,
  onCancel,
}: {
  checkId: string;
  askBy: string;
  onSent: () => Promise<unknown>;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = note.trim().length;

  async function send() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/verification/identity-check/ask", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ checkId, reason: note.trim() }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setError(payload.error || "Your request wasn't sent. Please try again.");
        return;
      }
      await onSent();
    } catch {
      setError("Your request wasn't sent. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      aria-labelledby="ask-person-title"
      className="space-y-3 rounded-2xl border border-border p-4"
    >
      <h3 id="ask-person-title" className="font-display text-xl font-bold text-foreground">
        Ask a person to look again
      </h3>
      <p className="text-sm leading-6 text-muted-foreground">
        A computer made this decision, so you can ask for a person to review it. Someone from our
        team will look at your ID photo, your selfie and the names you typed, and decide. You can
        ask once for each check{askBy ? `, by ${askBy}` : ""}.
      </p>
      <div className="space-y-2">
        <Label htmlFor="ask-person-note">Anything we should know?</Label>
        <Textarea
          id="ask-person-note"
          value={note}
          maxLength={ASK_NOTE.max}
          rows={4}
          aria-describedby="ask-person-count"
          onChange={(event) => setNote(event.target.value)}
        />
        <p id="ask-person-count" className="text-xs text-muted-foreground">
          At least {ASK_NOTE.min} characters · {length}/{ASK_NOTE.max}
        </p>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        We keep your photos only while your request is open. If a person can&apos;t verify you
        either, we delete your photos, ID number and names, and keep only a one-way code that stops
        the same ID being used twice.
      </p>
      {error && (
        <p className="inline-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
        <Button
          variant="trust-verified"
          onClick={() => void send()}
          disabled={sending || length < ASK_NOTE.min}
        >
          {sending && (
            <Loader2
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          Send to a person
        </Button>
      </div>
    </section>
  );
}

export function IndependentCheckDeclined({
  view,
  onTryAgain,
  onAsked,
}: {
  view: Extract<IdentityCheckView, { kind: "declined" }>;
  onTryAgain: () => void;
  onAsked: () => Promise<unknown>;
}) {
  const [asking, setAsking] = useState(false);
  const words = DECLINE_TEXT[view.reason];
  const askBy = formatAskByDate(view.askBy);
  return (
    <>
      <StatusCallout tone="attention" title="We couldn’t verify your ID." role="alert">
        <p>{words.text}</p>
        <p className="text-xs leading-5">{words.tip}</p>
      </StatusCallout>
      {asking ? (
        <AskPersonForm
          checkId={view.checkId}
          askBy={askBy}
          onSent={onAsked}
          onCancel={() => setAsking(false)}
        />
      ) : (
        <>
          {view.canRetry && (
            <section className="space-y-3 rounded-2xl border border-border p-4">
              <h3 className="flex items-center gap-2 font-body text-base font-semibold text-foreground">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Try again
              </h3>
              <p className="text-sm text-muted-foreground">
                You can try the ID check up to 3 times in 7 days.
              </p>
              <Button variant="trust-verified" size="lg" className="w-full" onClick={onTryAgain}>
                Try the ID check again
              </Button>
            </section>
          )}
          {view.canAsk && (
            <section className="space-y-3 rounded-2xl border border-border p-4">
              <h3 className="flex items-center gap-2 font-body text-base font-semibold text-foreground">
                <UserCheck className="h-4 w-4" aria-hidden="true" />
                Think we got it wrong?
              </h3>
              <p className="text-sm text-muted-foreground">
                A person from our team looks at your photos and decides.
                {askBy ? ` Ask by ${askBy}.` : ""}
              </p>
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                onClick={() => setAsking(true)}
              >
                Ask a person to look again
              </Button>
            </section>
          )}
        </>
      )}
    </>
  );
}

/* ── 08: paused or over the limit ─────────────────────────────────────── */

export function AutomaticCheckFallbackNote() {
  return (
    <StatusCallout tone="neutral">
      <p>
        The automatic check isn&apos;t available right now. Take your photos here and one of our
        team will check them.
      </p>
    </StatusCallout>
  );
}
