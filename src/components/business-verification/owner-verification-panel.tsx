"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Building2,
  Eye,
  Check,
  Clock,
  FileUp,
  IdCard,
  Link2,
  Loader2,
  Send,
} from "lucide-react";

import { SeenRequest } from "@/components/business-verification/seen-request";
import { BusinessStickers } from "@/components/trust/business-stickers";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { withCsrfHeaders } from "@/lib/utils/csrf";

type Message = { id: string; from: string; mine: boolean; body: string; createdAt: string };
type Case = {
  id: string;
  kind: "cipc" | "cipc_link" | "seen";
  status:
    "pending" | "info_requested" | "approved" | "rejected" | "revoked" | "expired" | "withdrawn";
  route: string | null;
  registrationNumber: string | null;
  reasonCode: string | null;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
  messages: Message[];
  seenMethod?: string | null;
  seenScheduledFor?: string | null;
  representative: {
    email: string | null;
    position: string | null;
    emailVerified: boolean;
    codeSent: boolean;
  } | null;
};
type State = {
  business: { id: string; name: string };
  stickers: {
    idReviewed: boolean;
    cipc: {
      verifiedAt: string;
      expiresAt: string | null;
      registrationNumber: string | null;
      registeredName: string | null;
      role: string | null;
      position: string | null;
      showFullRegisteredOffice: boolean;
    } | null;
    seen: { verifiedAt: string; method: string | null; city: string | null } | null;
  };
  cases: Case[];
  linkable: Array<{ businessId: string; businessName: string; registeredName: string | null }>;
};
type Preview = {
  readable: boolean;
  docType: string | null;
  registrationNumber: string | null;
  registeredName: string | null;
  status: string | null;
  directors: Array<{ name: string; role: string | null }>;
  registeredOffice: string | null;
  ownerListedAs: string | null;
};

const REASONS: Record<string, string> = {
  not_in_business: "CIPC doesn't show the company as In Business.",
  owner_not_director:
    "We couldn't confirm you as a director. Use the company representative option.",
  document_not_cipc: "The file wasn't a CIPC document.",
  document_altered: "The document looked edited. Download a fresh copy from CIPC.",
  details_mismatch: "The details didn't match CIPC's records.",
  conflict_other_owner: "Another account already holds this company's sticker. Contact support.",
  unreadable: "We couldn't read the file. Download a fresh copy from CIPC.",
  ownership_changed: "The business changed owner.",
  source_revoked:
    "The company's main profile lost its CIPC sticker, so this linked profile did too.",
  no_reply: "We closed the request because we didn't hear back in 30 days.",
};

const DOC_NAMES: Record<string, string> = {
  official_disclosure: "Disclosure Certificate",
  registration_certificate: "Registration Certificate (CoR14.3)",
  free_disclosure: "Free disclosure",
};

function formatDate(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })
    : "";
}

/** Renewal opens 60 days before expiry. */
function renewDue(expiresAt: string | null) {
  return Boolean(expiresAt) && Date.parse(expiresAt as string) - Date.now() < 60 * 86_400_000;
}

async function fetchVerificationState(
  businessId: string
): Promise<{ state: State } | { error: string }> {
  const res = await fetch(`/api/businesses/${businessId}/verification`, { cache: "no-store" });
  if (!res.ok) return { error: await readError(res) };
  return { state: (await res.json()) as State };
}

async function readError(res: Response) {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? "Something went wrong. Please try again.";
}

function StepShell({
  icon: Icon,
  title,
  state,
  children,
}: {
  icon: typeof IdCard;
  title: string;
  state: "done" | "review" | "fix" | "todo";
  children: React.ReactNode;
}) {
  const chip = {
    done: {
      label: "Done",
      icon: Check,
      cls: "bg-brand-green-100 text-brand-green-800 dark:bg-brand-green-500/15 dark:text-brand-green-200",
    },
    review: {
      label: "In review",
      icon: Clock,
      cls: "bg-brand-gold-100 text-brand-gold-900 dark:bg-brand-gold-400/15 dark:text-brand-gold-200",
    },
    fix: {
      label: "Needs you",
      icon: AlertCircle,
      cls: "bg-brand-red-100 text-brand-red-800 dark:bg-brand-red-500/15 dark:text-brand-red-200",
    },
    todo: { label: "To do", icon: Clock, cls: "bg-muted text-muted-foreground" },
  }[state];
  const ChipIcon = chip.icon;
  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Icon
              aria-hidden="true"
              className="h-5 w-5 text-brand-green-700 dark:text-brand-green-300"
            />
            {title}
          </h2>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
              chip.cls
            )}
          >
            <ChipIcon aria-hidden="true" className="h-3.5 w-3.5" />
            {chip.label}
          </span>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Thread({
  caseItem,
  businessId,
  onSent,
}: {
  caseItem: Case;
  businessId: string;
  onSent: () => void;
}) {
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = caseItem.status === "pending" || caseItem.status === "info_requested";

  async function send() {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("caseId", caseItem.id);
    if (body.trim()) form.set("body", body.trim());
    if (file) form.set("file", file);
    const res = await fetch(`/api/businesses/${businessId}/verification/messages`, {
      method: "POST",
      headers: withCsrfHeaders(),
      body: form,
    });
    setBusy(false);
    if (!res.ok) return setError(await readError(res));
    setBody("");
    setFile(null);
    onSent();
  }

  return (
    <div className="space-y-3">
      {caseItem.messages.length > 0 && (
        <ol className="space-y-2" aria-label="Messages">
          {caseItem.messages.map((m) => (
            <li
              key={m.id}
              className={cn(
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                m.mine ? "ml-auto bg-brand-green-700 text-white" : "bg-muted text-foreground"
              )}
            >
              <p className="text-xs font-medium opacity-80">
                {m.from} · {formatDate(m.createdAt)}
              </p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ol>
      )}
      {open && (
        <div className="space-y-2">
          <Label htmlFor={`reply-${caseItem.id}`}>Reply to our team</Label>
          <Textarea
            id={`reply-${caseItem.id}`}
            value={body}
            maxLength={2000}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Optional message"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Label htmlFor={`reply-file-${caseItem.id}`} className="sr-only">
              Attach a new document
            </Label>
            <Input
              id={`reply-file-${caseItem.id}`}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              onClick={send}
              disabled={busy || (!body.trim() && !file)}
              className="h-11 gap-1.5"
            >
              {busy ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Send aria-hidden="true" className="h-4 w-4" />
              )}
              Send
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-brand-red-700 dark:text-brand-red-300">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RepresentativeSteps({
  caseItem,
  businessId,
  onDone,
}: {
  caseItem: Case;
  businessId: string;
  onDone: () => void;
}) {
  const rep = caseItem.representative;
  const [email, setEmail] = useState(rep?.email ?? "");
  const [position, setPosition] = useState(rep?.position ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/businesses/${businessId}/verification/work-email`, {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ caseId: caseItem.id, ...body }),
    });
    setBusy(false);
    if (!res.ok) return setMessage(await readError(res));
    if (body.action === "send") setMessage("Code sent. Check your work inbox.");
    onDone();
  }

  if (rep?.emailVerified) {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-brand-green-50 p-2 text-sm text-brand-green-900 dark:bg-brand-green-500/10 dark:text-brand-green-100">
        <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        Work email {rep.email} confirmed. Our team will phone your company on a number we find
        ourselves to confirm you can represent it.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-3 text-sm">
      <p className="font-medium">Confirm your work email</p>
      <p className="text-muted-foreground">
        Use an address on your company&apos;s own website domain (not Gmail or Outlook).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="rep-email">Work email</Label>
          <Input
            id="rep-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rep-position">Your position</Label>
          <Input
            id="rep-position"
            value={position}
            maxLength={40}
            placeholder="e.g. Marketing Manager"
            onChange={(e) => setPosition(e.target.value)}
          />
        </div>
      </div>
      <Button
        variant="outline"
        className="h-11"
        disabled={busy || !email.trim() || position.trim().length < 2}
        onClick={() => call({ action: "send", email: email.trim(), position: position.trim() })}
      >
        {rep?.codeSent ? "Send a new code" : "Send code"}
      </Button>
      {rep?.codeSent && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="rep-code">6-digit code</Label>
            <Input
              id="rep-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <Button
            className="h-11"
            disabled={busy || code.length !== 6}
            onClick={() => call({ action: "verify", code })}
          >
            Confirm
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  );
}

function CipcUpload({ businessId, onSubmitted }: { businessId: string; onSubmitted: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [number, setNumber] = useState("");
  const [representative, setRepresentative] = useState(false);
  const [busy, setBusy] = useState<"reading" | "sending" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function read(selected: File) {
    setFile(selected);
    setPreview(null);
    setError(null);
    setBusy("reading");
    const form = new FormData();
    form.set("file", selected);
    const res = await fetch(`/api/businesses/${businessId}/verification/cipc/preview`, {
      method: "POST",
      headers: withCsrfHeaders(),
      body: form,
    });
    setBusy(null);
    if (!res.ok) return setError(await readError(res));
    const data = (await res.json()) as { preview: Preview };
    setPreview(data.preview);
    setNumber(data.preview.registrationNumber ?? "");
    setRepresentative(data.preview.readable && !data.preview.ownerListedAs);
  }

  async function submit() {
    if (!file) return;
    setBusy("sending");
    setError(null);
    const form = new FormData();
    form.set("file", file);
    if (number.trim()) form.set("registrationNumber", number.trim());
    form.set("route", representative ? "representative" : "director");
    const res = await fetch(`/api/businesses/${businessId}/verification/cipc`, {
      method: "POST",
      headers: withCsrfHeaders(),
      body: form,
    });
    setBusy(null);
    if (!res.ok) return setError(await readError(res));
    onSubmitted();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="cipc-file">Upload a CIPC document for your company</Label>
        <p className="text-sm text-muted-foreground">
          A free disclosure, Disclosure Certificate or Registration Certificate (CoR14.3). The PDF
          you downloaded from CIPC works best.{" "}
          <Link
            href="/help/business-verification#documents"
            className="font-medium underline underline-offset-2"
          >
            Which document?
          </Link>
        </p>
        <Input
          id="cipc-file"
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const selected = e.target.files?.[0];
            if (selected) void read(selected);
          }}
        />
      </div>

      {busy === "reading" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Reading your document…
        </p>
      )}

      {preview && (
        <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-3 text-sm">
          {preview.readable ? (
            <>
              <p className="font-semibold">What we read</p>
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                {preview.docType && (
                  <>
                    <dt className="text-muted-foreground">Document</dt>
                    <dd>{DOC_NAMES[preview.docType] ?? preview.docType}</dd>
                  </>
                )}
                {preview.registeredName && (
                  <>
                    <dt className="text-muted-foreground">Company</dt>
                    <dd>{preview.registeredName}</dd>
                  </>
                )}
                {preview.status && (
                  <>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>{preview.status}</dd>
                  </>
                )}
                {preview.registeredOffice && (
                  <>
                    <dt className="text-muted-foreground">Registered office</dt>
                    <dd>{preview.registeredOffice}</dd>
                  </>
                )}
                {preview.directors.length > 0 && (
                  <>
                    <dt className="text-muted-foreground">Directors</dt>
                    <dd>{preview.directors.map((d) => d.name).join("; ")}</dd>
                  </>
                )}
              </dl>
              <p
                className={cn(
                  "flex items-start gap-2 rounded-lg p-2",
                  preview.ownerListedAs
                    ? "bg-brand-green-50 text-brand-green-900 dark:bg-brand-green-500/10 dark:text-brand-green-100"
                    : "bg-brand-gold-50 text-brand-gold-900 dark:bg-brand-gold-400/10 dark:text-brand-gold-100"
                )}
              >
                {preview.ownerListedAs ? (
                  <>
                    <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /> You appear as{" "}
                    {preview.ownerListedAs}.
                  </>
                ) : (
                  <>
                    <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /> We
                    couldn&apos;t find you on the director list. You can still send it, and our team
                    will check.
                  </>
                )}
              </p>
            </>
          ) : (
            <p>
              We couldn&apos;t read this file automatically. You can still send it — our team checks
              every document.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="cipc-number">Registration number</Label>
            <Input
              id="cipc-number"
              value={number}
              inputMode="numeric"
              maxLength={20}
              placeholder="e.g. 2020/123456/07"
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>

          <label className="flex min-h-11 cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={representative}
              onChange={(e) => setRepresentative(e.target.checked)}
              className="mt-1 h-4 w-4 accent-brand-green-700"
            />
            <span>
              I&apos;m not a director — I represent the company (for example a manager).{" "}
              <span className="text-muted-foreground">
                We&apos;ll confirm this with your company by phone and work email.
              </span>
            </span>
          </label>

          <Button
            onClick={submit}
            disabled={busy !== null || !number.trim()}
            className="h-11 w-full gap-1.5 sm:w-auto"
          >
            {busy === "sending" ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Send aria-hidden="true" className="h-4 w-4" />
            )}
            Send for review
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-brand-red-700 dark:text-brand-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

export function OwnerVerificationPanel({ businessId }: { businessId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Errors from actions on a loaded page (renew, link, cancel, visibility).
  const [actionError, setActionError] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [renewing, setRenewing] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchVerificationState(businessId);
    if ("error" in result) setLoadError(result.error);
    else setState(result.state);
  }, [businessId]);

  useEffect(() => {
    let cancelled = false;
    void fetchVerificationState(businessId).then((result) => {
      if (cancelled) return;
      if ("error" in result) setLoadError(result.error);
      else setState(result.state);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  async function withdraw(caseId: string, what: string) {
    if (!window.confirm(`Cancel this ${what}? You can start again later.`)) return;
    setActionError(null);
    const res = await fetch(`/api/businesses/${businessId}/verification/withdraw`, {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ caseId }),
    });
    if (!res.ok) return setActionError(await readError(res));
    void load();
  }

  async function renew() {
    setActionError(null);
    setRenewing(true);
    const res = await fetch(`/api/businesses/${businessId}/verification/renew`, {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: "{}",
    });
    setRenewing(false);
    if (!res.ok) return setActionError(await readError(res));
    void load();
  }

  async function setOfficeVisibility(showFull: boolean) {
    const res = await fetch(`/api/businesses/${businessId}/verification/office-visibility`, {
      method: "PATCH",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ showFull }),
    });
    if (!res.ok) return setActionError(await readError(res));
    void load();
  }

  async function link(sourceBusinessId: string) {
    setActionError(null);
    setLinking(sourceBusinessId);
    const res = await fetch(`/api/businesses/${businessId}/verification/link`, {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ sourceBusinessId }),
    });
    setLinking(null);
    if (!res.ok) return setActionError(await readError(res));
    void load();
  }

  if (loadError && !state) {
    return (
      <p role="alert" className="text-sm text-brand-red-700 dark:text-brand-red-300">
        {loadError}
      </p>
    );
  }
  if (!state) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  const { stickers } = state;
  const cipcCases = state.cases.filter((c) => c.kind !== "seen");
  const openCipc = cipcCases.find((c) => c.status === "pending" || c.status === "info_requested");
  const seenCases = state.cases.filter((c) => c.kind === "seen");
  const openSeen = seenCases.find((c) => c.status === "pending" || c.status === "info_requested");
  const seenState =
    openSeen?.status === "info_requested"
      ? "fix"
      : openSeen
        ? "review"
        : stickers.seen
          ? "done"
          : "todo";
  const lastClosed = cipcCases.find(
    (c) => c.status === "rejected" || c.status === "revoked" || c.status === "expired"
  );
  const cipcState =
    openCipc?.status === "info_requested"
      ? "fix"
      : openCipc
        ? "review"
        : stickers.cipc
          ? "done"
          : "todo";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <div>
            <p className="text-sm text-muted-foreground">Business</p>
            <p className="text-lg font-semibold">{state.business.name}</p>
          </div>
          <BusinessStickers
            size="md"
            state={{
              idReviewed: stickers.idReviewed,
              cipcCheckedAt: stickers.cipc?.verifiedAt,
              seenAt: stickers.seen?.verifiedAt,
              seenMethod: stickers.seen?.method,
              seenCity: stickers.seen?.city,
            }}
          />
        </CardContent>
      </Card>

      {actionError && (
        <p
          role="alert"
          className="rounded-xl border border-brand-red-200 bg-brand-red-50 p-3 text-sm text-brand-red-800 dark:border-brand-red-500/30 dark:bg-brand-red-500/10 dark:text-brand-red-200"
        >
          {actionError}
        </p>
      )}

      <StepShell icon={IdCard} title="ID reviewed" state={stickers.idReviewed ? "done" : "todo"}>
        {stickers.idReviewed ? (
          <p className="text-sm text-muted-foreground">Your ID and selfie were reviewed.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Verify your ID first. The other stickers build on it.
            </p>
            <Button asChild className="h-11">
              <Link href="/verification">Verify my ID</Link>
            </Button>
          </div>
        )}
      </StepShell>

      <StepShell icon={Building2} title="CIPC registered" state={cipcState}>
        {stickers.cipc && !openCipc ? (
          <div className="space-y-3 text-sm">
            <p>
              Registered as <span className="font-medium">{stickers.cipc.registeredName}</span> ·{" "}
              {stickers.cipc.registrationNumber}
              {stickers.cipc.position ? ` · you: ${stickers.cipc.position}` : ""}
            </p>
            <p className="text-muted-foreground">
              Checked {formatDate(stickers.cipc.verifiedAt)}
              {stickers.cipc.expiresAt ? ` · renew by ${formatDate(stickers.cipc.expiresAt)}` : ""}
            </p>
            <label className="flex min-h-11 cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={stickers.cipc.showFullRegisteredOffice}
                onChange={(e) => setOfficeVisibility(e.target.checked)}
                className="mt-1 h-4 w-4 accent-brand-green-700"
              />
              <span>
                Show the full street address of my registered office.{" "}
                <span className="text-muted-foreground">
                  Off: only suburb, city and province show.
                </span>
              </span>
            </label>
            {renewDue(stickers.cipc.expiresAt) && (
              <Button className="h-11" onClick={renew} disabled={renewing}>
                {renewing && <Loader2 aria-hidden="true" className="mr-1 h-4 w-4 animate-spin" />}
                Renew now
              </Button>
            )}
          </div>
        ) : !stickers.idReviewed ? (
          <p className="text-sm text-muted-foreground">Available once your ID is reviewed.</p>
        ) : openCipc ? (
          <div className="space-y-3">
            <p className="text-sm">
              {openCipc.status === "info_requested"
                ? "Our team needs something from you — see the message below."
                : openCipc.kind === "cipc_link"
                  ? "We're confirming this profile belongs to your verified company."
                  : "We're checking your document against CIPC's records. This usually takes one business day."}
            </p>
            {openCipc.route === "representative" && (
              <RepresentativeSteps caseItem={openCipc} businessId={businessId} onDone={load} />
            )}
            <Thread caseItem={openCipc} businessId={businessId} onSent={load} />
            <Button
              variant="ghost"
              size="sm"
              className="h-11"
              onClick={() => withdraw(openCipc.id, "request")}
            >
              Cancel this request
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {lastClosed?.status === "expired" && (
              <Button className="h-11" onClick={renew} disabled={renewing}>
                {renewing && <Loader2 aria-hidden="true" className="mr-1 h-4 w-4 animate-spin" />}
                Renew in one tap
              </Button>
            )}
            {lastClosed && lastClosed.status !== "expired" && (
              <div className="rounded-xl border border-brand-red-200 bg-brand-red-50 p-3 text-sm dark:border-brand-red-500/30 dark:bg-brand-red-500/10">
                <p className="font-semibold">Last request not approved</p>
                <p>
                  {(lastClosed.reasonCode && REASONS[lastClosed.reasonCode]) ||
                    "See the note from our team."}
                </p>
                {lastClosed.note && <p className="mt-1 text-muted-foreground">{lastClosed.note}</p>}
              </div>
            )}
            {state.linkable.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Same company as another of your profiles?</p>
                {state.linkable.map((l) => (
                  <Button
                    key={l.businessId}
                    variant="outline"
                    className="h-11 w-full justify-start gap-2 sm:w-auto"
                    disabled={linking !== null}
                    onClick={() => link(l.businessId)}
                  >
                    <Link2 aria-hidden="true" className="h-4 w-4" />
                    Link to {l.registeredName ?? l.businessName}
                  </Button>
                ))}
              </div>
            )}
            <CipcUpload businessId={businessId} onSubmitted={load} />
          </div>
        )}
      </StepShell>

      <StepShell icon={Eye} title="Seen by VerifyMzansi" state={seenState}>
        {stickers.seen && !openSeen ? (
          <p className="text-sm text-muted-foreground">
            {stickers.seen.method === "visit" ? "Visited" : "Seen on live video"} ·{" "}
            {formatDate(stickers.seen.verifiedAt)}
          </p>
        ) : !stickers.idReviewed ? (
          <p className="text-sm text-muted-foreground">Available once your ID is reviewed.</p>
        ) : openSeen ? (
          <div className="space-y-3">
            <p className="text-sm">
              {openSeen.seenScheduledFor
                ? `Booked for ${new Date(openSeen.seenScheduledFor).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" })}.`
                : "We'll book a time from the options you gave and let you know."}
            </p>
            <Thread caseItem={openSeen} businessId={businessId} onSent={load} />
            <Button
              variant="ghost"
              size="sm"
              className="h-11"
              onClick={() => withdraw(openSeen.id, "check")}
            >
              Cancel this check
            </Button>
          </div>
        ) : (
          <SeenRequest businessId={businessId} onBooked={load} />
        )}
      </StepShell>

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <FileUp aria-hidden="true" className="h-4 w-4" />
        <Link href="/help/business-verification" className="underline underline-offset-2">
          How business verification works
        </Link>
      </p>
    </div>
  );
}
