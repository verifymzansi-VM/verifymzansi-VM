"use client";

import { useState } from "react";
import { Camera, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MIN_SEEN_PHOTOS, PREMISES_TYPES, type SeenState } from "@/lib/business-verification/seen";
import { withCsrfHeaders } from "@/lib/utils/csrf";

const PREMISES_LABELS: Record<(typeof PREMISES_TYPES)[number], string> = {
  shop: "Shop or showroom",
  home_based: "Home-based",
  market_stall: "Market stall",
  mobile_service: "Mobile service",
  online_with_stock: "Online, with stock or work samples",
  office: "Office",
};

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "That did not work.");
}

function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000 }
    )
  );
}

/**
 * Verifier workspace for a Seen case: book the check, add photos (with the
 * device's location for visits), and file the report a second person approves.
 */
export function SeenPanel({
  caseId,
  updatedAt,
  seen,
  ownerLegalName,
  viewerId,
  blocked,
  onDone,
}: {
  caseId: string;
  updatedAt: string;
  seen: SeenState;
  ownerLegalName: string | null;
  viewerId: string;
  blocked: boolean;
  onDone: () => void;
}) {
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState({
    outcome: "seen" as "seen" | "not_confirmed",
    identityConfirmed: false,
    signage: false,
    productsSeen: "",
    premisesType: "shop" as (typeof PREMISES_TYPES)[number],
    notes: "",
  });
  const mine = seen.assignedTo === viewerId;
  const myPhotos = (seen.photos ?? []).filter((p) => p.by === viewerId).length;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  async function addPhoto(file: File) {
    await run("photo", async () => {
      const form = new FormData();
      form.set("file", file);
      if (seen.method === "visit") {
        const pos = await currentPosition();
        if (pos) {
          form.set("lat", String(pos.lat));
          form.set("lng", String(pos.lng));
        }
      }
      const res = await fetch(`/api/admin/business-verification/${caseId}/visit-photo`, {
        method: "POST",
        headers: withCsrfHeaders(),
        body: form,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Upload failed.");
      }
    });
  }

  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Method</dt>
        <dd>{seen.method === "visit" ? "In-person visit" : "Live video call"}</dd>
        {seen.address && (
          <>
            <dt className="text-muted-foreground">Address</dt>
            <dd>{seen.address}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Owner&apos;s times</dt>
        <dd>{(seen.slots ?? []).join(" · ") || "—"}</dd>
        <dt className="text-muted-foreground">Booked</dt>
        <dd>
          {seen.scheduledFor
            ? new Date(seen.scheduledFor).toLocaleString("en-ZA", {
                timeZone: "Africa/Johannesburg",
              })
            : "Not yet"}
          {seen.assignedTo ? (mine ? " · you" : " · another verifier") : ""}
        </dd>
        <dt className="text-muted-foreground">Photos</dt>
        <dd>{(seen.photos ?? []).length}</dd>
      </dl>

      {!seen.report && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="seen-when">{seen.scheduledFor ? "Rebook for" : "Book for"}</Label>
            <Input
              id="seen-when"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            className="h-11"
            disabled={blocked || !when || busy !== null}
            onClick={() =>
              run("schedule", () =>
                post(`/api/admin/business-verification/${caseId}/visit`, {
                  action: "schedule",
                  expectedUpdatedAt: updatedAt,
                  scheduledFor: new Date(when).toISOString(),
                })
              )
            }
          >
            {seen.assignedTo && !mine ? "Take over and book" : "Book and tell the owner"}
          </Button>
        </div>
      )}

      {mine && !seen.report && (
        <>
          <div className="space-y-1">
            <Label htmlFor="seen-photo" className="flex items-center gap-1.5">
              <Camera aria-hidden="true" className="h-4 w-4" />
              Add a photo or screenshot ({myPhotos}/{MIN_SEEN_PHOTOS})
            </Label>
            <Input
              id="seen-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              disabled={blocked || busy !== null}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void addPhoto(file);
                e.target.value = "";
              }}
            />
            <p className="text-xs text-muted-foreground">
              Screenshots only with the owner&apos;s consent (given when they booked). Photos stay
              private.
            </p>
          </div>

          <fieldset className="space-y-2 rounded-xl border p-3">
            <legend className="px-1 font-medium">What you saw</legend>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={report.identityConfirmed}
                onChange={(e) => setReport({ ...report, identityConfirmed: e.target.checked })}
                className="h-4 w-4"
              />
              The person showed an ID matching the owner&apos;s verified name
              {ownerLegalName ? ` (${ownerLegalName})` : ""}
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={report.signage}
                onChange={(e) => setReport({ ...report, signage: e.target.checked })}
                className="h-4 w-4"
              />
              Business name or signage seen
            </label>
            <div className="space-y-1">
              <Label htmlFor="seen-products">Products or services seen</Label>
              <Textarea
                id="seen-products"
                value={report.productsSeen}
                maxLength={500}
                onChange={(e) => setReport({ ...report, productsSeen: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="seen-premises">Premises</Label>
              <select
                id="seen-premises"
                value={report.premisesType}
                onChange={(e) =>
                  setReport({
                    ...report,
                    premisesType: e.target.value as (typeof PREMISES_TYPES)[number],
                  })
                }
                className="h-11 w-full rounded-xl border border-input bg-card px-3"
              >
                {PREMISES_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {PREMISES_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="seen-notes">Notes</Label>
              <Textarea
                id="seen-notes"
                value={report.notes}
                maxLength={1000}
                onChange={(e) => setReport({ ...report, notes: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                className="h-11"
                disabled={
                  blocked ||
                  busy !== null ||
                  report.productsSeen.trim().length < 3 ||
                  myPhotos < MIN_SEEN_PHOTOS
                }
                onClick={() =>
                  run("report", () =>
                    post(`/api/admin/business-verification/${caseId}/visit`, {
                      action: "report",
                      expectedUpdatedAt: updatedAt,
                      ...report,
                      outcome: "seen",
                      notes: report.notes.trim() || null,
                    })
                  )
                }
              >
                {busy === "report" && (
                  <Loader2 aria-hidden="true" className="mr-1 h-4 w-4 animate-spin" />
                )}
                Submit report
              </Button>
              <Button
                variant="outline"
                className="h-11"
                disabled={blocked || busy !== null || report.productsSeen.trim().length < 3}
                onClick={() =>
                  run("report", () =>
                    post(`/api/admin/business-verification/${caseId}/visit`, {
                      action: "report",
                      expectedUpdatedAt: updatedAt,
                      ...report,
                      outcome: "not_confirmed",
                      notes: report.notes.trim() || null,
                    })
                  )
                }
              >
                Couldn&apos;t confirm
              </Button>
            </div>
          </fieldset>
        </>
      )}

      {seen.report && (
        <div className="rounded-xl border p-3">
          <p className="font-medium">
            Report: {seen.report.outcome === "seen" ? "business seen" : "could not confirm"}
            {seen.report.by === viewerId ? " (yours — another staff member approves)" : ""}
          </p>
          <p>
            ID matched owner: {seen.report.identityConfirmed ? "yes" : "no"} · Signage:{" "}
            {seen.report.signage ? "yes" : "no"}
          </p>
          <p>Premises: {PREMISES_LABELS[seen.report.premisesType]}</p>
          <p>Seen: {seen.report.productsSeen}</p>
          {seen.report.notes && <p className="text-muted-foreground">{seen.report.notes}</p>}
        </div>
      )}

      {error && (
        <p role="alert" className="text-brand-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
