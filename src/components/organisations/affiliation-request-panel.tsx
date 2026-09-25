"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";

export interface MemberApplication {
  id: string;
  organisation_id: string;
  business_id: string;
  status: string;
  info_request: string | null;
  decision_note: string | null;
  created_at: string;
  organisations: { name: string; slug: string } | null;
}

export interface MemberAffiliation {
  id: string;
  organisation_id: string;
  business_id: string;
  confirmed_at: string;
  organisations: { name: string; slug: string; affiliation_wording: string } | null;
}

interface SearchResult {
  id: string;
  slug: string;
  name: string;
  organisation_type: string;
  service_area: string | null;
  organisation_programmes: Array<{ id: string; name: string; active: boolean }> | null;
}

const STATUS_LABELS: Record<string, string> = {
  submitted: "Waiting for the organisation",
  more_info_required: "More information requested",
  approved: "Confirmed",
  declined: "Not confirmed",
  withdrawn: "Withdrawn",
};

const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeZone: "Africa/Johannesburg",
});
const field = "mt-1 block h-11 w-full rounded-md border bg-background px-3 text-sm";

async function post(body: unknown) {
  const res = await fetch("/api/affiliations", {
    method: "POST",
    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? null : ((data.error as string | undefined) ?? "Request failed");
}

export function AffiliationRequestPanel({
  businesses,
  applications,
  affiliations,
  sharedFields,
}: {
  businesses: Array<{ id: string; name: string; status: string }>;
  applications: MemberApplication[];
  affiliations: MemberAffiliation[];
  sharedFields: string[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  const [consent, setConsent] = useState(false);
  const [shareName, setShareName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/organisations/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : { organisations: [] }))
        .then((data) => setResults(data.organisations ?? []))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const businessName = (id: string) => businesses.find((b) => b.id === id)?.name ?? "Business";

  if (businesses.length === 0) {
    return (
      <section className="rounded-xl border p-5 text-sm">
        <p>Create a Mzansi Business profile first, then request affiliation for it.</p>
        <Button asChild className="mt-3 h-11">
          <Link href="/post/create-business">Create business profile</Link>
        </Button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {affiliations.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Confirmed affiliations</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {affiliations.map((row) => (
              <li key={row.id} className="rounded-xl border p-3 text-sm">
                <p className="font-medium">{row.organisations?.name}</p>
                <p className="text-muted-foreground">
                  {row.organisations?.affiliation_wording} · {businessName(row.business_id)} · since{" "}
                  {date.format(new Date(row.confirmed_at))}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-4 rounded-xl border p-4 sm:p-5">
        <h2 className="text-base font-semibold">Request organisation affiliation</h2>
        <label className="block text-sm">
          Find an organisation or programme
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. municipality, chamber, tourism association"
            className={field}
          />
        </label>
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Organisations">
          {results.map((org) => (
            <li key={org.id}>
              <button
                type="button"
                onClick={() => setSelected(org)}
                aria-pressed={selected?.id === org.id}
                className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                  selected?.id === org.id
                    ? "border-brand-green bg-brand-green/5"
                    : "hover:bg-muted/50"
                }`}
              >
                <span className="block font-medium">{org.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {org.organisation_type.replace(/_/g, " ")}
                  {org.service_area ? ` · ${org.service_area}` : ""}
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 ? (
            <li className="text-sm text-muted-foreground">No participating organisations found.</li>
          ) : null}
        </ul>

        {selected ? (
          <form
            className="space-y-4 border-t pt-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setBusy(true);
              setMessage(null);
              const error = await post({
                action: "submit",
                businessId,
                organisationId: selected.id,
                programmeId: (form.get("programmeId") as string) || undefined,
                reason: (form.get("reason") as string) || undefined,
                reference: (form.get("reference") as string) || undefined,
                consent: { accepted: consent, shareRepresentativeName: shareName },
              });
              setBusy(false);
              if (error) {
                setMessage({ tone: "error", text: error });
                return;
              }
              setMessage({ tone: "success", text: `Request sent to ${selected.name}.` });
              setSelected(null);
              setConsent(false);
              router.refresh();
            }}
          >
            <p className="text-sm font-medium">Request to {selected.name}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Business
                <select
                  value={businessId}
                  onChange={(e) => setBusinessId(e.target.value)}
                  className={field}
                >
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              {(selected.organisation_programmes ?? []).filter((p) => p.active).length > 0 ? (
                <label className="text-sm">
                  Programme
                  <select name="programmeId" className={field}>
                    <option value="">Not sure / general</option>
                    {(selected.organisation_programmes ?? [])
                      .filter((p) => p.active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
              <label className="text-sm">
                Membership or registration reference (optional)
                <input name="reference" maxLength={120} className={field} />
              </label>
              <label className="text-sm sm:col-span-2">
                Why are you part of this programme? (optional)
                <textarea
                  name="reason"
                  maxLength={1000}
                  rows={2}
                  className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
                />
              </label>
            </div>

            <fieldset className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <legend className="px-1 font-medium">Information shared with {selected.name}</legend>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {sharedFields.map((text) => (
                  <li key={text}>{text}</li>
                ))}
                {shareName ? <li>Your verified legal name</li> : null}
              </ul>
              <p className="text-xs text-muted-foreground">
                Your ID document, selfie and verification records are never shared.
              </p>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={shareName}
                  onChange={(e) => setShareName(e.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                Also share my verified legal name as the business representative
              </label>
              <label className="flex items-start gap-2 font-medium">
                <input
                  type="checkbox"
                  required
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                I consent to VerifyMzansi sharing this information with {selected.name} so it can
                confirm my business&apos;s participation.
              </label>
            </fieldset>
            <Button type="submit" className="h-11" disabled={busy || !consent}>
              {busy ? "Sending…" : "Send request"}
            </Button>
          </form>
        ) : null}
        {message ? (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={
              message.tone === "error" ? "text-sm text-destructive" : "text-sm text-brand-green-700"
            }
          >
            {message.text}
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Your requests</h2>
        {applications.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet.</p>
        ) : (
          <ul className="space-y-3">
            {applications.map((app) => (
              <ApplicationItem
                key={app.id}
                app={app}
                businessName={businessName(app.business_id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ApplicationItem({ app, businessName }: { app: MemberApplication; businessName: string }) {
  const router = useRouter();
  const [response, setResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: "respond" | "withdraw") {
    setBusy(true);
    setError(null);
    const failure = await post({
      action,
      applicationId: app.id,
      response: action === "respond" ? response : undefined,
    });
    setBusy(false);
    if (failure) setError(failure);
    else router.refresh();
  }

  return (
    <li className="space-y-2 rounded-xl border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{app.organisations?.name ?? "Organisation"}</p>
        <Badge variant={app.status === "approved" ? "default" : "outline"}>
          {STATUS_LABELS[app.status] ?? app.status}
        </Badge>
      </div>
      <p className="text-muted-foreground">
        {businessName} · sent {date.format(new Date(app.created_at))}
      </p>
      {app.status === "declined" ? (
        <p className="text-muted-foreground">
          Your VerifyMzansi account and listings are unaffected.{" "}
          {app.decision_note ? `Note: ${app.decision_note}` : ""}
        </p>
      ) : null}
      {app.status === "more_info_required" ? (
        <div className="space-y-2">
          <p>Requested: {app.info_request}</p>
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            rows={2}
            maxLength={2000}
            aria-label="Your response"
            className="block w-full rounded-md border bg-background p-2"
          />
          <Button
            className="h-11"
            disabled={busy || response.trim().length < 2}
            onClick={() => void run("respond")}
          >
            Send response
          </Button>
        </div>
      ) : null}
      {app.status === "submitted" || app.status === "more_info_required" ? (
        <Button
          variant="ghost"
          className="h-11"
          disabled={busy}
          onClick={() => void run("withdraw")}
        >
          Withdraw request
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}
