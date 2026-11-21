"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileSearch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import {
  AUTHORITY_REQUESTS_ENDPOINT,
  AUTHORITY_REQUESTS_PATH,
  LOOKUP_KINDS,
  REQUEST_TYPES,
  type LookupKind,
  type RequestType,
} from "@/lib/admin/authority-requests";

const SELECT =
  "flex h-11 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Which field a refusal is about, so the screen can point at it. */
const FIELD_OF: Record<string, string> = {
  disclosure_request_type_invalid: "authority-type",
  disclosure_reference_required: "authority-reference",
  disclosure_reason_required: "authority-reason",
  disclosure_attestation_required: "authority-attested",
  disclosure_lookup_invalid: "authority-lookup-kind",
  disclosure_lookup_value_invalid: "authority-lookup-value",
};

export function AuthorityRequestForm() {
  const router = useRouter();
  const [requestType, setRequestType] = useState<RequestType>("subpoena");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [lookupKind, setLookupKind] = useState<LookupKind>("post");
  const [lookupValue, setLookupValue] = useState("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);

  const kind = LOOKUP_KINDS.find((item) => item.value === lookupKind) ?? LOOKUP_KINDS[0];
  const invalid = (id: string) => error?.field === id;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(AUTHORITY_REQUESTS_ENDPOINT, {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          requestType,
          reference,
          reason,
          lookupKind,
          lookupValue,
          attested,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.ok && typeof data.id === "string") {
        router.push(`${AUTHORITY_REQUESTS_PATH}/${data.id}`);
        return;
      }
      if (data.code === "step_up_required" && typeof data.redirectUrl === "string") {
        router.push(data.redirectUrl);
        return;
      }
      const reasonCode = typeof data.reason === "string" ? data.reason : "";
      setError({
        message:
          typeof data.error === "string" ? data.error : "Something went wrong. Please try again.",
        field: FIELD_OF[reasonCode] ?? null,
      });
    } catch {
      setError({
        message:
          "The request could not be confirmed. Reload the page; if a record opened, it is listed under Earlier requests.",
        field: null,
      });
    }
    setBusy(false);
  }

  const describedBy = (id: string, hint?: string) =>
    [hint, invalid(id) ? "authority-error" : null].filter(Boolean).join(" ") || undefined;

  return (
    <Card className="max-w-4xl p-4 sm:p-6">
      <form onSubmit={submit} className="space-y-6" noValidate>
        <fieldset className="space-y-4" disabled={busy}>
          <legend className="font-display text-lg font-semibold">1. The request</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="authority-type">Type of request</Label>
              <select
                id="authority-type"
                className={cn(SELECT, invalid("authority-type") && "border-destructive")}
                value={requestType}
                onChange={(e) => setRequestType(e.target.value as RequestType)}
                aria-invalid={invalid("authority-type") || undefined}
              >
                {REQUEST_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="authority-reference">Request reference</Label>
              <Input
                id="authority-reference"
                className="h-11"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={100}
                required
                autoComplete="off"
                aria-invalid={invalid("authority-reference") || undefined}
                aria-describedby={describedBy("authority-reference", "authority-reference-hint")}
              />
              <p id="authority-reference-hint" className="text-sm text-muted-foreground">
                The subpoena, court order or police case number.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="authority-reason">Reason</Label>
            <Textarea
              id="authority-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              required
              aria-invalid={invalid("authority-reason") || undefined}
              aria-describedby={describedBy("authority-reason")}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-4" disabled={busy}>
          <legend className="font-display text-lg font-semibold">2. Find the person</legend>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="authority-lookup-kind">Search by</Label>
              <select
                id="authority-lookup-kind"
                className={SELECT}
                value={lookupKind}
                onChange={(e) => {
                  setLookupKind(e.target.value as LookupKind);
                  setLookupValue("");
                }}
              >
                {LOOKUP_KINDS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="authority-lookup-value">{kind.label}</Label>
              <Input
                id="authority-lookup-value"
                className="h-11"
                value={lookupValue}
                onChange={(e) => setLookupValue(e.target.value)}
                inputMode={kind.inputMode}
                placeholder={kind.placeholder}
                maxLength={2048}
                required
                autoComplete="off"
                spellCheck={false}
                aria-invalid={invalid("authority-lookup-value") || undefined}
                aria-describedby={describedBy("authority-lookup-value", "authority-lookup-hint")}
              />
              <p id="authority-lookup-hint" className="text-sm text-muted-foreground">
                Or the ID number, phone number or email address named in the request. Searching by
                name is not allowed.
              </p>
            </div>
          </div>
          <label
            htmlFor="authority-attested"
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border bg-muted/40 p-4 text-sm",
              invalid("authority-attested") && "border-destructive"
            )}
          >
            <input
              id="authority-attested"
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-input accent-brand-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:accent-brand-green-400"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              aria-invalid={invalid("authority-attested") || undefined}
            />
            <span>
              I have checked that this request is genuine, signed, and names this person or this
              post. I will keep the original with the company records.
            </span>
          </label>
        </fieldset>

        {error && (
          <p id="authority-error" role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}

        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Opening the record writes your name, the reference and the time to the Audit log. A
            search that finds nobody is logged too.
          </p>
          <Button type="submit" className="h-11 w-full shrink-0 sm:w-auto" disabled={busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileSearch className="h-4 w-4" />
            )}
            Open record
          </Button>
        </div>
      </form>
    </Card>
  );
}
