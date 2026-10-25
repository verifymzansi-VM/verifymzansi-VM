"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth-store";
import { getFoundationBrowserClient } from "@/lib/foundation/browser-client";
import {
  readFoundationOrganisationLinks,
  readFoundationOrganisationApplications,
  readFoundationOrganisationAffiliations,
  decideFoundationApplication,
  updateFoundationAffiliation,
} from "@/lib/foundation/organisations";
import {
  readFoundationOrganisationSponsorships,
  changeFoundationSponsorship,
} from "@/lib/foundation/organisation-sponsorships";
async function readOrganisation(slug: string) {
  const api = getFoundationBrowserClient();
  const links = await readFoundationOrganisationLinks(api);
  const org = links.administers.find((item) => item.organisation_slug === slug);
  if (!org) throw new Error("You do not currently administer this organisation");
  const input = { organisation_id: org.organisation_id };
  const [applications, affiliations, sponsorships] = await Promise.all([
    readFoundationOrganisationApplications(api, input),
    readFoundationOrganisationAffiliations(api, input),
    readFoundationOrganisationSponsorships(api, input),
  ]);
  return { org, applications, affiliations, sponsorships };
}
export function FoundationOrganisationManager({ slug }: { slug: string }) {
  const accountId = useAuthStore((state) => state.user?.id);
  return <OrganisationAccount key={`${accountId}/${slug}`} slug={slug} />;
}
function OrganisationAccount({ slug }: { slug: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof readOrganisation>>>();
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void readOrganisation(slug).then(
      (value) => {
        if (active) setData(value);
      },
      (error) => {
        if (active)
          setMessage(
            error instanceof Error ? error.message : "The organisation could not be loaded"
          );
      }
    );
    return () => {
      active = false;
    };
  }, [slug, revision]);
  async function run(command: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await command();
      setRevision((value) => value + 1);
      setMessage("Change saved.");
    } catch {
      setMessage(
        "The change could not be completed. Refresh to check current permissions and the latest status before trying again."
      );
    } finally {
      setBusy(false);
    }
  }
  const reasonForm = (action: (reason: string) => Promise<unknown>, label: string) => (
    <form
      className="flex flex-wrap gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const reason = String(new FormData(event.currentTarget).get("reason"));
        void run(() => action(reason));
      }}
    >
      <input
        required
        minLength={5}
        maxLength={500}
        aria-label={`${label} reason`}
        name="reason"
        placeholder="Reason for this change"
        className="min-w-0 flex-1 rounded-lg border bg-background p-3"
      />
      <button disabled={busy} className="rounded-lg border px-4 py-3">
        {label}
      </button>
    </form>
  );
  return (
    <div className="space-y-7">
      <header>
        <h1 className="font-display text-2xl font-bold">
          {data?.org.organisation_name ?? "Organisation dashboard"}
        </h1>
        <Link className="mt-2 inline-block underline" href={`/organisation/${slug}`}>
          Public organisation page
        </Link>
      </header>
      {message && (
        <p role="status" className="rounded-xl border p-4">
          {message}
        </p>
      )}
      <button
        disabled={busy}
        className="rounded-lg border px-4 py-3"
        onClick={() => setRevision((value) => value + 1)}
      >
        Refresh
      </button>
      {data && (
        <>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Applications</h2>
            {!data.applications.length && <p>No applications yet.</p>}
            {data.applications.map((item) => (
              <article key={item.id} className="space-y-3 rounded-xl border bg-card p-5">
                <h3 className="font-semibold">
                  {item.business_name ?? "Business"} · {item.status.replaceAll("_", " ")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {item.category.replaceAll("_", " ")} · {item.province?.replaceAll("_", " ")} ·{" "}
                  {item.identity_verified ? "Identity reviewed" : "Identity not reviewed"}
                </p>
                {item.representative_name && <p>Representative: {item.representative_name}</p>}
                {item.reason && <p className="whitespace-pre-wrap">{item.reason}</p>}
                {item.info_response && (
                  <p className="whitespace-pre-wrap">
                    Additional information: {item.info_response}
                  </p>
                )}
                {["submitted", "more_info_required"].includes(item.status) && (
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void run(() =>
                        decideFoundationApplication(getFoundationBrowserClient(), {
                          application_id: item.id,
                          decision: String(form.get("decision")),
                          ...(String(form.get("note")).trim()
                            ? { note: String(form.get("note")) }
                            : {}),
                        })
                      );
                    }}
                  >
                    <label className="block">
                      Decision
                      <select name="decision" className="ml-3 rounded-lg border bg-background p-2">
                        <option value="approve">Approve affiliation</option>
                        <option value="decline">Decline application</option>
                        <option value="request_info">Request more information</option>
                      </select>
                    </label>
                    <label className="block">
                      Note or information requested
                      <textarea
                        name="note"
                        maxLength={1000}
                        className="mt-2 w-full rounded-lg border bg-background p-3"
                      />
                    </label>
                    <button
                      disabled={busy}
                      className="rounded-lg bg-primary px-4 py-3 text-primary-foreground"
                    >
                      Save decision
                    </button>
                  </form>
                )}
              </article>
            ))}
          </section>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Affiliated businesses</h2>
            {!data.affiliations.length && <p>No confirmed affiliates yet.</p>}
            {data.affiliations.map((item) => (
              <article key={item.id} className="space-y-4 rounded-xl border bg-card p-5">
                <h3 className="font-semibold">{item.business_name ?? "Business"}</h3>
                <p>
                  {item.affiliation_type} · {item.live ? "Live" : "Not public"}
                  {item.programme_name && ` · ${item.programme_name}`}
                </p>
                <label className="block">
                  Affiliation type
                  <select
                    value={item.affiliation_type}
                    disabled={busy}
                    className="ml-3 rounded-lg border bg-background p-2"
                    onChange={(event) =>
                      void run(() =>
                        updateFoundationAffiliation(getFoundationBrowserClient(), {
                          affiliation_id: item.id,
                          action: "set_type",
                          affiliation_type: event.target.value,
                        })
                      )
                    }
                  >
                    <option value="participant">Participant</option>
                    <option value="member">Member</option>
                    <option value="affiliate">Affiliate</option>
                  </select>
                </label>
                {reasonForm(
                  (reason) =>
                    changeFoundationSponsorship(getFoundationBrowserClient(), {
                      action: "sponsor",
                      affiliation_id: item.id,
                      reason,
                    }),
                  "Sponsor posting place"
                )}
                {reasonForm(
                  (reason) =>
                    updateFoundationAffiliation(getFoundationBrowserClient(), {
                      affiliation_id: item.id,
                      action: "revoke",
                      reason,
                    }),
                  "Revoke affiliation"
                )}
              </article>
            ))}
          </section>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Sponsored posting places</h2>
            <p>
              {data.sponsorships.active} active of {data.sponsorships.capacity} places ·{" "}
              {data.sponsorships.waitlisted} waiting ·{" "}
              {data.sponsorships.programme_status.replaceAll("_", " ")}
            </p>
            {data.sponsorships.items.map((item) => (
              <article key={item.id} className="space-y-3 rounded-xl border p-5">
                <h3 className="font-semibold">
                  {item.business_name ?? "Business"} · {item.status}
                </h3>
                {item.ends_at && <p>Ends {new Date(item.ends_at).toLocaleDateString("en-ZA")}</p>}
                {["active", "waitlisted"].includes(item.status) &&
                  reasonForm(
                    (reason) =>
                      changeFoundationSponsorship(getFoundationBrowserClient(), {
                        action: "end",
                        sponsorship_id: item.id,
                        reason,
                      }),
                    "End sponsorship"
                  )}
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
