"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Send,
  X,
} from "lucide-react";

import { CallbackForm } from "@/components/admin/business-verification/callback-form";
import { SeenPanel } from "@/components/admin/business-verification/seen-panel";
import { seenApprovalGaps, type SeenState } from "@/lib/business-verification/seen";
import { ClaimBadge, useQueueClaim } from "@/components/admin/queue-claims";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CaseDetail } from "@/lib/business-verification/admin-queries";
import { cn } from "@/lib/utils";
import { withCsrfHeaders } from "@/lib/utils/csrf";

type Detail = NonNullable<CaseDetail>;

const REASONS: Array<{ code: string; label: string; note: string }> = [
  {
    code: "not_in_business",
    label: "Not In Business",
    note: "CIPC shows the company is not In Business. Bring your annual returns up to date with CIPC, then send a new disclosure.",
  },
  {
    code: "owner_not_director",
    label: "Owner not a director",
    note: "Your verified ID isn't on CIPC's director list. If you're a manager or other staff member, use the company representative option.",
  },
  {
    code: "document_not_cipc",
    label: "Not a CIPC document",
    note: "The file isn't a CIPC document. Upload the disclosure or registration certificate you downloaded from CIPC.",
  },
  {
    code: "document_altered",
    label: "Document altered",
    note: "The document appears to have been edited. Download a fresh copy from CIPC and upload it unchanged.",
  },
  {
    code: "details_mismatch",
    label: "Details don't match CIPC",
    note: "The details on your document don't match CIPC's records.",
  },
  {
    code: "conflict_other_owner",
    label: "Held by another owner",
    note: "Another account already holds this company's sticker. Contact support so we can look into it.",
  },
  {
    code: "unreadable",
    label: "Unreadable",
    note: "We couldn't read your file. Upload the PDF you downloaded from CIPC.",
  },
  { code: "other", label: "Other", note: "" },
];

const SEVERITY = {
  attention: {
    icon: CircleAlert,
    cls: "border-brand-red-300 bg-brand-red-50 text-brand-red-900 dark:border-brand-red-500/40 dark:bg-brand-red-500/10 dark:text-brand-red-100",
    label: "Needs attention",
  },
  check: {
    icon: AlertTriangle,
    cls: "border-brand-gold-300 bg-brand-gold-50 text-brand-gold-900 dark:border-brand-gold-400/40 dark:bg-brand-gold-400/10 dark:text-brand-gold-100",
    label: "Check",
  },
  ok: {
    icon: Check,
    cls: "border-brand-green-300 bg-brand-green-50 text-brand-green-900 dark:border-brand-green-500/40 dark:bg-brand-green-500/10 dark:text-brand-green-100",
    label: "OK",
  },
} as const;

async function postJson(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "That did not work. Try again.");
  return data;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function FileViewer({ file }: { file: Detail["files"][number] }) {
  const [state, setState] = useState<{
    url?: string;
    text?: string;
    error?: string;
    loading?: boolean;
  }>({});
  const label =
    file.kind === "admin_copy"
      ? "Your CIPC copy"
      : file.kind === "owner_upload"
        ? "Owner's document"
        : file.kind === "visit_photo"
          ? "Visit photo"
          : "Attachment";

  async function open() {
    setState({ loading: true });
    const res = await fetch(`/api/admin/business-verification/files/${file.id}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return setState({ error: data.error ?? "Could not load the file." });
    }
    if (res.headers.get("X-Quarantined")) return setState({ text: await res.text() });
    setState({ url: URL.createObjectURL(await res.blob()) });
  }

  return (
    <li className="space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <FileText aria-hidden="true" className="h-4 w-4" />
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {file.content_type} · {Math.round(file.size_bytes / 1024)} KB
          {file.producer ? ` · ${file.producer}` : ""}
          {file.revision_count && file.revision_count > 1 ? ` · saved ${file.revision_count}×` : ""}
        </span>
        {file.quarantined && <span className="font-semibold text-brand-red-700">Quarantined</span>}
        {file.purged_at ? (
          <span className="text-muted-foreground">Deleted (retention)</span>
        ) : (
          !state.url &&
          !state.text && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-9"
              onClick={open}
              disabled={state.loading}
            >
              {state.loading ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                "View"
              )}
            </Button>
          )
        )}
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-brand-red-700">
          {state.error}
        </p>
      )}
      {state.text !== undefined && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
          {state.text}
        </pre>
      )}
      {state.url &&
        (file.content_type === "application/pdf" ? (
          <iframe title={label} src={state.url} className="h-[32rem] w-full rounded-lg border" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- decrypted blob URL
          <img src={state.url} alt={label} className="max-h-[32rem] w-auto rounded-lg border" />
        ))}
    </li>
  );
}

function Compare({ detail }: { detail: Detail }) {
  const copy = detail.adminCopy;
  const officeLine = (lines: string[] | undefined) => (lines?.length ? lines.join(", ") : "—");
  const adminOffice = copy?.registeredOffice as {
    suburb?: string;
    city?: string;
    province?: string;
  } | null;
  const rows: Array<[string, string | null, string | null, string | null]> = [
    [
      "Registration number",
      detail.parsed.registrationNumber,
      copy?.registrationNumber ?? null,
      detail.registrationNumber,
    ],
    [
      "Registered name",
      detail.parsed.registeredName,
      copy?.registeredName ?? null,
      detail.business?.business_name ?? null,
    ],
    ["Status", detail.parsed.enterpriseStatus, copy?.enterpriseStatus ?? null, null],
    [
      "Registered office",
      officeLine(detail.parsed.registeredOfficeLines),
      adminOffice
        ? [adminOffice.suburb, adminOffice.city, adminOffice.province].filter(Boolean).join(", ")
        : null,
      [detail.business?.location_city, detail.business?.location_province]
        .filter(Boolean)
        .join(", ") || null,
    ],
    [
      "Owner on director list",
      detail.ownerMatchOnUpload ? `Yes — ${detail.ownerMatchOnUpload}` : "No",
      copy
        ? copy.directors.find((d) => d.isOwner)?.name
          ? `Yes — ${copy.directors.find((d) => d.isOwner)?.name}`
          : "No"
        : null,
      null,
    ],
  ];
  const differs = new Set(copy?.differences.map((d) => d.field) ?? []);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Field</th>
            <th className="py-2 pr-3 font-medium">Owner&apos;s document</th>
            <th className="py-2 pr-3 font-medium">Your CIPC copy</th>
            <th className="py-2 font-medium">Profile</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([field, owner, cipc, profile]) => (
            <tr
              key={field}
              className={cn(
                "border-t",
                differs.has(field) && "bg-brand-red-50 dark:bg-brand-red-500/10"
              )}
            >
              <th scope="row" className="py-2 pr-3 text-left font-medium">
                {field}
              </th>
              <td className="py-2 pr-3">{owner ?? "—"}</td>
              <td className="py-2 pr-3">{cipc ?? (copy ? "—" : "Attach your copy")}</td>
              <td className="py-2">{profile ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {copy && (
        <p
          className={cn(
            "mt-3 flex items-center gap-2 rounded-xl p-3 text-sm font-medium",
            copy.differences.length
              ? "bg-brand-red-50 text-brand-red-900 dark:bg-brand-red-500/10 dark:text-brand-red-100"
              : "bg-brand-green-50 text-brand-green-900 dark:bg-brand-green-500/10 dark:text-brand-green-100"
          )}
        >
          {copy.differences.length ? (
            <>
              <X aria-hidden="true" className="h-4 w-4" /> {copy.differences.length} difference(s)
              between the owner&apos;s document and CIPC.
            </>
          ) : (
            <>
              <Check aria-hidden="true" className="h-4 w-4" /> All match.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function AdminCopyForm({
  detail,
  onDone,
  blocked,
}: {
  detail: Detail;
  onDone: () => void;
  blocked: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    if (reference.trim()) form.set("cipcReference", reference.trim());
    const res = await fetch(`/api/admin/business-verification/${detail.id}/admin-copy`, {
      method: "POST",
      headers: withCsrfHeaders(),
      body: form,
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return setError(data.error ?? "Upload failed.");
    }
    onDone();
  }

  return (
    <div className="space-y-3">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>
          Open CIPC and search the company.{" "}
          <a
            href="https://eservices.cipc.co.za/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium underline"
          >
            CIPC eServices <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </li>
        <li>
          Download the free disclosure (or the R30 disclosure if the free one has no ID numbers).
        </li>
        <li>Attach it here unchanged. We compare it with the owner&apos;s document.</li>
      </ol>
      {detail.registrationNumber && (
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1.5"
          onClick={async () => {
            await navigator.clipboard.writeText(detail.registrationNumber ?? "");
            setCopied(true);
          }}
        >
          <Copy aria-hidden="true" className="h-3.5 w-3.5" />
          {copied ? "Copied" : `Copy ${detail.registrationNumber}`}
        </Button>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="admin-copy-file">CIPC copy (PDF)</Label>
          <Input
            id="admin-copy-file"
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="admin-copy-ref">CIPC reference (optional)</Label>
          <Input
            id="admin-copy-ref"
            value={reference}
            maxLength={80}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
      </div>
      <Button onClick={upload} disabled={!file || busy || blocked} className="h-11">
        {busy && <Loader2 aria-hidden="true" className="mr-1 h-4 w-4 animate-spin" />}
        Attach and compare
      </Button>
      {error && (
        <p role="alert" className="text-sm text-brand-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function OfficeForm({
  detail,
  onDone,
  blocked,
}: {
  detail: Detail;
  onDone: () => void;
  blocked: boolean;
}) {
  const office = (detail.registeredOffice ?? {}) as {
    streetLines?: string[];
    suburb?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    cityKnown?: boolean;
  };
  const [values, setValues] = useState({
    street: (office.streetLines ?? []).join(", "),
    suburb: office.suburb ?? "",
    city: office.city ?? "",
    province: office.province ?? "",
    postalCode: office.postalCode ?? "",
  });
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setMsg(null);
    try {
      await postJson(
        `/api/admin/business-verification/${detail.id}/office`,
        {
          streetLines: values.street
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 3),
          suburb: values.suburb.trim() || null,
          city: values.city.trim(),
          province: values.province.trim(),
          postalCode: values.postalCode.trim() || null,
        },
        "PATCH"
      );
      onDone();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not save.");
    }
  }

  const field = (key: keyof typeof values, label: string) => (
    <div className="space-y-1">
      <Label htmlFor={`office-${key}`}>{label}</Label>
      <Input
        id={`office-${key}`}
        value={values[key]}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Shown on the profile as suburb, city and province. The street shows only if the owner
        chooses.
        {office.cityKnown === false ? " The city isn't in our list — check the spelling." : ""}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("street", "Street (comma-separated lines)")}
        {field("suburb", "Suburb")}
        {field("city", "City")}
        {field("province", "Province")}
        {field("postalCode", "Postal code")}
      </div>
      <Button variant="outline" onClick={save} disabled={blocked} className="h-11">
        Save registered office
      </Button>
      {msg && (
        <p role="alert" className="text-sm text-brand-red-700">
          {msg}
        </p>
      )}
    </div>
  );
}

function Messages({ detail, onDone }: { detail: Detail; onDone: () => void }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setError(null);
    try {
      await postJson(`/api/admin/business-verification/${detail.id}/message`, { body });
      setBody("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send.");
    }
  }
  return (
    <div className="space-y-3">
      {detail.messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages yet.</p>
      ) : (
        <ol className="space-y-2">
          {detail.messages.map((m) => (
            <li
              key={m.id}
              className={cn(
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                m.author_role === "staff" ? "ml-auto bg-brand-green-700 text-white" : "bg-muted"
              )}
            >
              <p className="text-xs opacity-80">
                {m.author_role === "staff" ? "Staff" : "Owner"} ·{" "}
                {new Date(m.created_at).toLocaleString("en-ZA")}
                {m.attachment_file_id ? " · sent a file" : ""}
              </p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ol>
      )}
      <div className="space-y-2">
        <Label htmlFor="staff-message">Message the owner (doesn&apos;t change the status)</Label>
        <Textarea
          id="staff-message"
          value={body}
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button variant="outline" className="h-11 gap-1.5" disabled={!body.trim()} onClick={send}>
          <Send aria-hidden="true" className="h-4 w-4" /> Send
        </Button>
        {error && (
          <p role="alert" className="text-sm text-brand-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Decide({
  detail,
  viewerId,
  canDecideSenior,
  blocked,
  blockedReason,
  onDone,
}: {
  detail: Detail;
  viewerId: string;
  canDecideSenior: boolean;
  blocked: boolean;
  blockedReason: string | null;
  onDone: () => void;
}) {
  const [inBusiness, setInBusiness] = useState(false);
  const [ownerConfirmed, setOwnerConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exception = detail.checks?.exception;
  const exceptionPending = Boolean(exception?.proposedBy && !exception.confirmedBy);
  const open = detail.status === "pending" || detail.status === "info_requested";

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setError(null);
    try {
      await postJson(`/api/admin/business-verification/${detail.id}/decide`, {
        action,
        expectedUpdatedAt: detail.updatedAt,
        ...extra,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  if (detail.status === "approved") {
    return canDecideSenior ? (
      <div className="space-y-3">
        <p className="text-sm">
          Approved {detail.decidedAt ? new Date(detail.decidedAt).toLocaleDateString("en-ZA") : ""}
          {detail.expiresAt
            ? ` · renews by ${new Date(detail.expiresAt).toLocaleDateString("en-ZA")}`
            : ""}
          .
        </p>
        <ReasonPicker reason={reason} setReason={setReason} note={note} setNote={setNote} />
        <Button
          variant="destructive"
          className="h-11"
          disabled={!reason || !note.trim() || busy !== null}
          onClick={() => run("revoke", { reasonCode: reason, note })}
        >
          Remove sticker
        </Button>
        {error && (
          <p role="alert" className="text-sm text-brand-red-700">
            {error}
          </p>
        )}
      </div>
    ) : (
      <p className="text-sm">
        Approved. Only a governance controller or admin can remove a sticker.
      </p>
    );
  }
  if (!open) {
    return (
      <p className="text-sm">
        {detail.status} {detail.reviewNote ? `— ${detail.reviewNote}` : ""}
      </p>
    );
  }

  const isSeen = detail.kind === "seen";
  const missing = isSeen
    ? seenApprovalGaps(detail.seen as SeenState | null, viewerId)
    : (detail.evidence?.missing ?? []);
  const isLink = detail.kind === "cipc_link" || isSeen;

  return (
    <div className="space-y-4">
      {blockedReason && <p className="rounded-xl bg-muted p-3 text-sm">{blockedReason}</p>}

      {exceptionPending ? (
        <div className="space-y-2 rounded-xl border border-brand-gold-300 p-3 text-sm">
          <p className="font-semibold">Exception proposed — needs a second reviewer</p>
          <p>{exception?.reason}</p>
          {canDecideSenior && exception?.proposedBy !== viewerId ? (
            <Button
              className="h-11"
              disabled={busy !== null || blocked}
              onClick={() => run("confirm_exception")}
            >
              Confirm exception and approve
            </Button>
          ) : (
            <p className="text-muted-foreground">
              A different governance controller or admin must confirm it.
            </p>
          )}
        </div>
      ) : (
        <>
          {!isLink && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">What you confirmed on your CIPC copy</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={inBusiness}
                  onChange={(e) => setInBusiness(e.target.checked)}
                  className="h-4 w-4"
                />
                The company is In Business
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ownerConfirmed}
                  onChange={(e) => setOwnerConfirmed(e.target.checked)}
                  className="h-4 w-4"
                />
                {detail.route === "representative"
                  ? "The representative is confirmed (work email and call-back)"
                  : "The owner is an active director or member"}
              </label>
            </fieldset>
          )}
          {missing.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-brand-red-50 p-3 text-sm text-brand-red-900 dark:bg-brand-red-500/10 dark:text-brand-red-100">
              {missing.map((m) => (
                <li key={m}>• {m}</li>
              ))}
            </ul>
          )}
          <Button
            className="h-11 gap-1.5"
            disabled={
              busy !== null ||
              blocked ||
              missing.length > 0 ||
              (!isLink && (!inBusiness || !ownerConfirmed))
            }
            onClick={() =>
              run("approve", { checks: { inBusiness, ownerConfirmed }, note: note || undefined })
            }
          >
            {busy === "approve" ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Check aria-hidden="true" className="h-4 w-4" />
            )}
            Approve
          </Button>
        </>
      )}

      <div className="space-y-3 border-t pt-4">
        <ReasonPicker reason={reason} setReason={setReason} note={note} setNote={setNote} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-11"
            disabled={busy !== null || blocked || !note.trim()}
            onClick={() => run("request_info", { note })}
          >
            Ask the owner
          </Button>
          <Button
            variant="destructive"
            className="h-11"
            disabled={busy !== null || blocked || !reason || !note.trim()}
            onClick={() => run("reject", { reasonCode: reason, note })}
          >
            Reject
          </Button>
          {!exceptionPending && missing.length > 0 && (
            <Button
              variant="ghost"
              className="h-11"
              disabled={busy !== null || blocked || note.trim().length < 10}
              onClick={() => run("propose_exception", { note })}
            >
              Propose exception
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          The note is sent to the owner. An exception approves despite the items above and needs a
          second, senior reviewer.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-brand-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function ReasonPicker({
  reason,
  setReason,
  note,
  setNote,
}: {
  reason: string;
  setReason: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[14rem,1fr]">
      <div className="space-y-1">
        <Label htmlFor="decision-reason">Reason</Label>
        <select
          id="decision-reason"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            const preset = REASONS.find((r) => r.code === e.target.value)?.note;
            if (preset && !note.trim()) setNote(preset);
          }}
          className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm"
        >
          <option value="">Choose…</option>
          {REASONS.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="decision-note">Note to the owner</Label>
        <Textarea
          id="decision-note"
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </div>
  );
}

export function CaseReview({
  detail,
  viewerId,
  canDecideSenior,
}: {
  detail: Detail;
  viewerId: string;
  canDecideSenior: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());
  const { blocked, blockedReason } = useQueueClaim("business_verification", detail.id);
  const open = detail.status === "pending" || detail.status === "info_requested";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr,22rem]">
      <div className="space-y-4">
        <div
          className={cn(
            "rounded-2xl border p-4 text-sm",
            detail.suggestion.action === "approve"
              ? "border-brand-green-300 bg-brand-green-50 dark:bg-brand-green-500/10"
              : "border-brand-gold-300 bg-brand-gold-50 dark:bg-brand-gold-400/10"
          )}
        >
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
            Suggestion — you decide
          </p>
          <p className="font-medium">{detail.suggestion.text}</p>
        </div>

        {detail.findings.length > 0 && (
          <Section title="What we found">
            <ul className="space-y-2">
              {detail.findings.map((f) => {
                const s = SEVERITY[f.severity];
                return (
                  <li
                    key={f.code}
                    className={cn("flex gap-2 rounded-xl border p-3 text-sm", s.cls)}
                  >
                    <s.icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">
                        <span className="sr-only">{s.label}: </span>
                        {f.title}
                      </p>
                      <p>{f.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {detail.kind === "cipc" && (
          <Section title="Compare with CIPC">
            <Compare detail={detail} />
          </Section>
        )}

        {detail.kind === "cipc" && open && (
          <Section title="Check CIPC yourself">
            <AdminCopyForm detail={detail} onDone={refresh} blocked={blocked} />
          </Section>
        )}

        <Section title="Documents">
          {detail.files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files on this case.</p>
          ) : (
            <ul className="space-y-2">
              {detail.files.map((f) => (
                <FileViewer key={f.id} file={f} />
              ))}
            </ul>
          )}
        </Section>

        {detail.kind === "seen" && (
          <Section
            title={(detail.seen as SeenState | null)?.method === "visit" ? "Visit" : "Video check"}
          >
            <SeenPanel
              caseId={detail.id}
              updatedAt={detail.updatedAt}
              seen={(detail.seen ?? { method: "video" }) as SeenState}
              ownerLegalName={detail.owner.legalName}
              viewerId={viewerId}
              blocked={blocked}
              onDone={refresh}
            />
          </Section>
        )}

        {detail.route === "representative" && open && (
          <Section title="Company representative">
            <CallbackForm
              caseId={detail.id}
              updatedAt={detail.updatedAt}
              representative={detail.representative}
              blocked={blocked}
              onDone={refresh}
            />
          </Section>
        )}

        {detail.kind === "cipc" && open && (
          <Section title="Registered office">
            <OfficeForm detail={detail} onDone={refresh} blocked={blocked} />
          </Section>
        )}

        <Section title="Messages">
          <Messages detail={detail} onDone={refresh} />
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="Owner">
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Name on ID</dt>
            <dd>{detail.owner.legalName ?? detail.owner.displayName ?? "—"}</dd>
            <dt className="text-muted-foreground">ID reviewed</dt>
            <dd>{detail.owner.idReviewed ? "Yes" : "No"}</dd>
            <dt className="text-muted-foreground">Route</dt>
            <dd>
              {detail.route === "representative"
                ? "Company representative"
                : detail.kind === "cipc_link"
                  ? "Linked profile"
                  : "Director"}
            </dd>
            <dt className="text-muted-foreground">Directors read</dt>
            <dd>
              {detail.parsed.directors.length === 0
                ? "—"
                : detail.parsed.directors.map((d) => (
                    <span key={d.name} className="block">
                      {d.name}
                      {d.role ? ` · ${d.role}` : ""}
                      {d.isOwner ? " · matches owner's ID" : ""}
                      {!d.hasSaId ? " · no SA ID" : ""}
                    </span>
                  ))}
            </dd>
          </dl>
          <p className="text-xs text-muted-foreground">
            ID numbers are never stored; matching uses a one-way hash of the owner&apos;s reviewed
            ID.
          </p>
        </Section>

        <Section title="Decision">
          <div className="flex items-center gap-2">
            <ClaimBadge type="business_verification" id={detail.id} />
          </div>
          <Decide
            detail={detail}
            viewerId={viewerId}
            canDecideSenior={canDecideSenior}
            blocked={blocked}
            blockedReason={blockedReason}
            onDone={refresh}
          />
        </Section>

        {detail.accessLog.length > 0 && (
          <Section title="Recent file views">
            <ul className="space-y-1 text-xs text-muted-foreground">
              {detail.accessLog.map((a) => (
                <li key={`${a.actor_id}-${a.created_at}`}>
                  {new Date(a.created_at).toLocaleString("en-ZA")} ·{" "}
                  {a.action === "view_file" ? "viewed a file" : a.action}
                  {a.actor_id === viewerId ? " (you)" : ""}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
