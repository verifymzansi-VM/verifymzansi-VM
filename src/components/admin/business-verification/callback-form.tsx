"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { withCsrfHeaders } from "@/lib/utils/csrf";

type Representative = {
  email?: string | null;
  position?: string | null;
  emailVerifiedAt?: string | null;
  domainConfirmed?: boolean;
  callback?: {
    numberSource: string;
    spokeTo: string;
    confirmedPosition: string;
    confirmed: boolean;
    notes: string | null;
  } | null;
  confirmed?: boolean;
};

/**
 * Staff confirm a company representative: the work email's domain is the
 * company's own, and a call to a number staff found themselves confirmed the
 * person may represent the company.
 */
export function CallbackForm({
  caseId,
  updatedAt,
  representative,
  blocked,
  onDone,
}: {
  caseId: string;
  updatedAt: string;
  representative: Record<string, unknown> | null;
  blocked: boolean;
  onDone: () => void;
}) {
  const rep = (representative ?? {}) as Representative;
  const [domainConfirmed, setDomainConfirmed] = useState(Boolean(rep.domainConfirmed));
  const [numberSource, setNumberSource] = useState(rep.callback?.numberSource ?? "");
  const [spokeTo, setSpokeTo] = useState(rep.callback?.spokeTo ?? "");
  const [position, setPosition] = useState(rep.callback?.confirmedPosition ?? rep.position ?? "");
  const [confirmed, setConfirmed] = useState(Boolean(rep.callback?.confirmed));
  const [notes, setNotes] = useState(rep.callback?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const domain = rep.email?.split("@")[1] ?? null;

  async function save() {
    setError(null);
    const res = await fetch(`/api/admin/business-verification/${caseId}/representative`, {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        expectedUpdatedAt: updatedAt,
        domainConfirmed,
        callback: {
          numberSource,
          spokeTo,
          confirmedPosition: position,
          confirmed,
          notes: notes.trim() || null,
        },
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return setError(data.error ?? "Could not save.");
    }
    onDone();
  }

  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Work email</dt>
        <dd>
          {rep.email ?? "Not sent yet"}
          {rep.emailVerifiedAt ? " · confirmed" : rep.email ? " · not confirmed yet" : ""}
        </dd>
        <dt className="text-muted-foreground">Stated position</dt>
        <dd>{rep.position ?? "—"}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>{rep.confirmed ? "Representative confirmed" : "Not confirmed yet"}</dd>
      </dl>

      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={domainConfirmed}
          onChange={(e) => setDomainConfirmed(e.target.checked)}
          className="h-4 w-4"
        />
        {domain
          ? `${domain} is the company's own website domain`
          : "The email domain is the company's own"}
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cb-source">Where you found the number</Label>
          <Input
            id="cb-source"
            value={numberSource}
            placeholder="e.g. company website contact page"
            onChange={(e) => setNumberSource(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cb-spoke">Who confirmed (name and role)</Label>
          <Input id="cb-spoke" value={spokeTo} onChange={(e) => setSpokeTo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cb-position">Confirmed position</Label>
          <Input
            id="cb-position"
            value={position}
            maxLength={40}
            onChange={(e) => setPosition(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cb-notes">Notes</Label>
          <Input
            id="cb-notes"
            value={notes}
            maxLength={1000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">Never call a number the applicant gave you.</p>

      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="h-4 w-4"
        />
        The company confirmed this person may represent it online
      </label>

      <Button
        variant="outline"
        className="h-11"
        disabled={
          blocked ||
          numberSource.trim().length < 5 ||
          spokeTo.trim().length < 2 ||
          position.trim().length < 2
        }
        onClick={save}
      >
        Save call-back
      </Button>
      {error && (
        <p role="alert" className="text-brand-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
