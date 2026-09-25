"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";

export interface OrganisationApplicationRow {
  id: string;
  status: string;
  business_id: string;
  business_name: string;
  category: string | null;
  city: string | null;
  province: string | null;
  business_phone: string | null;
  business_email: string | null;
  business_website: string | null;
  representative_name: string | null;
  identity_verified: boolean;
  programme_name: string | null;
  reason: string | null;
  member_reference: string | null;
  info_request: string | null;
  info_response: string | null;
  submitted_at: string;
  decision_at: string | null;
  decision_note: string | null;
}

export interface OrganisationMemberRow {
  affiliation_id: string;
  business_id: string;
  business_name: string;
  category: string | null;
  city: string | null;
  business_status: string;
  programme_name: string | null;
  confirmed_at: string;
  sponsorship_id: string | null;
  sponsorship_status: string | null;
  sponsor_type: string | null;
  sponsorship_ends_at: string | null;
}

const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeZone: "Africa/Johannesburg",
});
const label = (value: string | null) => (value ? value.replace(/_/g, " ") : "—");

function useOrganisationAction(organisationId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(key: string, payload: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/organisations/${organisationId}/manage`, {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "The change could not be applied.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Network error. Please try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { act, busy, error };
}

function askReason(prompt: string): string | null {
  const reason = window.prompt(prompt) ?? "";
  return reason.trim().length >= 5 ? reason.trim() : null;
}

/**
 * Affiliation requests. Shows only the minimum business information and a
 * yes/no identity indicator — never identity documents or verification data.
 */
export function ApplicationsReview({
  organisationId,
  applications,
}: {
  organisationId: string;
  applications: OrganisationApplicationRow[];
}) {
  const { act, busy, error } = useOrganisationAction(organisationId);
  const [filter, setFilter] = useState("submitted");
  const visible = applications.filter((row) => filter === "all" || row.status === filter);
  const counts = (status: string) => applications.filter((row) => row.status === status).length;

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Application status" className="flex flex-wrap gap-2">
        {[
          ["submitted", "Pending"],
          ["more_info_required", "More information"],
          ["approved", "Approved"],
          ["declined", "Declined"],
          ["all", "All"],
        ].map(([value, text]) => (
          <Button
            key={value}
            role="tab"
            aria-selected={filter === value}
            variant={filter === value ? "default" : "outline"}
            size="sm"
            className="h-10"
            onClick={() => setFilter(value!)}
          >
            {text}
            {value !== "all" ? ` (${counts(value!)})` : ""}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No applications here.</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => (
            <li
              key={row.id}
              className="space-y-2 rounded-xl border p-4"
              data-testid="organisation-application"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{row.business_name}</p>
                <Badge variant={row.identity_verified ? "default" : "secondary"}>
                  {row.identity_verified
                    ? "VerifyMzansi identity check completed"
                    : "Identity check not completed"}
                </Badge>
                <Badge variant="outline">{label(row.status)}</Badge>
              </div>
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="inline text-muted-foreground">Category: </dt>
                  <dd className="inline">{label(row.category)}</dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">Location: </dt>
                  <dd className="inline">
                    {[row.city, row.province].filter(Boolean).join(", ") || "—"}
                  </dd>
                </div>
                {row.representative_name ? (
                  <div>
                    <dt className="inline text-muted-foreground">Representative: </dt>
                    <dd className="inline">{row.representative_name}</dd>
                  </div>
                ) : null}
                {row.programme_name ? (
                  <div>
                    <dt className="inline text-muted-foreground">Programme: </dt>
                    <dd className="inline">{row.programme_name}</dd>
                  </div>
                ) : null}
                {row.member_reference ? (
                  <div>
                    <dt className="inline text-muted-foreground">Reference: </dt>
                    <dd className="inline">{row.member_reference}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="inline text-muted-foreground">Business contact: </dt>
                  <dd className="inline break-all">
                    {[row.business_phone, row.business_email, row.business_website]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-muted-foreground">Submitted: </dt>
                  <dd className="inline">{date.format(new Date(row.submitted_at))}</dd>
                </div>
              </dl>
              {row.reason ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">Reason: </span>
                  {row.reason}
                </p>
              ) : null}
              {row.info_request ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">You asked: </span>
                  {row.info_request}
                </p>
              ) : null}
              {row.info_response ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">Response: </span>
                  {row.info_response}
                </p>
              ) : null}
              {row.decision_note ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">Decision note: </span>
                  {row.decision_note}
                </p>
              ) : null}
              <Link
                href={`/mzansi-business/${row.business_id}`}
                className="text-sm underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                View public profile
              </Link>
              {row.status === "submitted" || row.status === "more_info_required" ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    className="h-11"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(`a-${row.id}`, {
                        action: "decide",
                        applicationId: row.id,
                        decision: "approve",
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11"
                    disabled={busy !== null}
                    onClick={() => {
                      const note = window.prompt(
                        "What information do you need? (sent to the applicant)"
                      );
                      if (note && note.trim().length >= 5)
                        void act(`i-${row.id}`, {
                          action: "decide",
                          applicationId: row.id,
                          decision: "request_info",
                          note: note.trim(),
                        });
                    }}
                  >
                    Request information
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 text-destructive"
                    disabled={busy !== null}
                    onClick={() => {
                      const note = window.prompt("Optional note for the applicant") ?? undefined;
                      void act(`d-${row.id}`, {
                        action: "decide",
                        applicationId: row.id,
                        decision: "decline",
                        note: note?.trim() || undefined,
                      });
                    }}
                  >
                    Decline
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Affiliated and sponsored businesses, with capped sponsorship controls. */
export function MembersManager({
  organisationId,
  members,
  sponsoredCapacity,
  canSponsor,
  allowFoundingSponsorship,
}: {
  organisationId: string;
  members: OrganisationMemberRow[];
  sponsoredCapacity: number;
  canSponsor: boolean;
  allowFoundingSponsorship: boolean;
}) {
  const { act, busy, error } = useOrganisationAction(organisationId);
  const [query, setQuery] = useState("");
  const [onlySponsored, setOnlySponsored] = useState(false);
  const active = members.filter((m) => m.sponsorship_status === "active").length;
  const waiting = members.filter((m) => m.sponsorship_status === "waitlisted").length;
  const visible = members.filter(
    (m) =>
      (!onlySponsored || m.sponsorship_status) &&
      (!query ||
        m.business_name.toLowerCase().includes(query.toLowerCase()) ||
        (m.city ?? "").toLowerCase().includes(query.toLowerCase()))
  );

  return (
    <div className="space-y-3">
      <p className="text-sm">
        <strong>{members.length}</strong> affiliated · <strong>{active}</strong> of{" "}
        {sponsoredCapacity} sponsored positions used
        {waiting ? ` · ${waiting} waiting` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search business or town"
          aria-label="Search members"
          className="h-11 min-w-[14rem] flex-1 rounded-md border bg-background px-3 text-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlySponsored}
            onChange={(e) => setOnlySponsored(e.target.checked)}
            className="h-4 w-4"
          />
          Sponsored or waiting only
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No businesses match.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((m) => (
            <li key={m.affiliation_id} className="space-y-2 rounded-xl border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/mzansi-business/${m.business_id}`}
                  className="font-semibold underline-offset-4 hover:underline"
                >
                  {m.business_name}
                </Link>
                {m.sponsorship_status === "active" ? (
                  <Badge>
                    {m.sponsor_type === "ORGANISATION" ? "Sponsored" : "Founding cohort"}
                  </Badge>
                ) : m.sponsorship_status === "waitlisted" ? (
                  <Badge variant="secondary">Waiting list</Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {label(m.category)} · {m.city ?? "—"} · listing {label(m.business_status)} ·
                confirmed {date.format(new Date(m.confirmed_at))}
                {m.sponsorship_ends_at
                  ? ` · sponsored until ${date.format(new Date(m.sponsorship_ends_at))}`
                  : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {canSponsor && !m.sponsorship_status ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-10"
                      disabled={busy !== null}
                      onClick={() => {
                        const reason = askReason("Reason for sponsoring this business (recorded)");
                        if (reason)
                          void act(`s-${m.affiliation_id}`, {
                            action: "sponsor",
                            affiliationId: m.affiliation_id,
                            sponsorType: "ORGANISATION",
                            reason,
                          });
                      }}
                    >
                      Sponsor (paid by organisation)
                    </Button>
                    {allowFoundingSponsorship ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-10"
                        disabled={busy !== null}
                        onClick={() => {
                          const reason = askReason(
                            "Reason for adding to the founding cohort (recorded)"
                          );
                          if (reason)
                            void act(`f-${m.affiliation_id}`, {
                              action: "sponsor",
                              affiliationId: m.affiliation_id,
                              sponsorType: "VERIFYMZANSI_FOUNDING",
                              reason,
                            });
                        }}
                      >
                        Add to founding cohort
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {m.sponsorship_id ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-10"
                    disabled={busy !== null}
                    onClick={() => {
                      const reason = askReason(
                        "Reason for ending sponsorship (the affiliation stays active)"
                      );
                      if (reason)
                        void act(`e-${m.sponsorship_id}`, {
                          action: "end_sponsorship",
                          sponsorshipId: m.sponsorship_id,
                          reason,
                        });
                    }}
                  >
                    End sponsorship
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-10 text-destructive"
                  disabled={busy !== null}
                  onClick={() => {
                    const reason = askReason(
                      "Reason for revoking this affiliation (the business keeps its VerifyMzansi account)"
                    );
                    if (reason)
                      void act(`r-${m.affiliation_id}`, {
                        action: "revoke",
                        affiliationId: m.affiliation_id,
                        reason,
                      });
                  }}
                >
                  Revoke affiliation
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
