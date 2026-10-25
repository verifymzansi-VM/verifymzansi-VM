"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { getFoundationBrowserClient } from "@/lib/foundation/browser-client";
import {
  readFoundationOrganisationDirectory,
  readFoundationPublicOrganisation,
  readFoundationOrganisationLinks,
  applyToFoundationOrganisation,
  updateMyFoundationApplication,
} from "@/lib/foundation/organisations";
import { readMyFoundationSponsorships } from "@/lib/foundation/organisation-sponsorships";
import { listFoundationOwnerPosts } from "@/lib/foundation/owner-posts";
async function readAffiliations() {
  const api = getFoundationBrowserClient();
  const [directory, links, sponsorships, posts] = await Promise.all([
    readFoundationOrganisationDirectory(api),
    readFoundationOrganisationLinks(api),
    readMyFoundationSponsorships(api),
    listFoundationOwnerPosts(api, 100),
  ]);
  return {
    directory,
    links,
    sponsorships,
    posts: posts.items.filter((post) => post.kind === "business" && post.status !== "archived"),
  };
}
export function FoundationAffiliations({ preselected }: { preselected?: string }) {
  const accountId = useAuthStore((state) => state.user?.id);
  return <AffiliationsAccount key={accountId ?? "anonymous"} preselected={preselected} />;
}
function AffiliationsAccount({ preselected }: { preselected?: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof readAffiliations>>>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void readAffiliations().then(
      (value) => {
        if (active) setData(value);
      },
      () => {
        if (active) setMessage("Affiliations could not be loaded. Refresh to try again.");
      }
    );
    return () => {
      active = false;
    };
  }, [revision]);
  async function run(command: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await command();
      setRevision((value) => value + 1);
      setMessage("Your request was saved.");
    } catch {
      setMessage(
        "The request could not be completed. Check verification, programme availability and the latest application status before trying again."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-7">
      <h1 className="font-display text-2xl font-bold">Organisation affiliations</h1>
      {message && (
        <p role="status" className="rounded-xl border p-4">
          {message}
        </p>
      )}
      {!data ? (
        <button className="underline" onClick={() => setRevision((value) => value + 1)}>
          Reload affiliations
        </button>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Confirmed affiliations</h2>
            {!data.links.affiliations.length && <p>No confirmed affiliations yet.</p>}
            {data.links.affiliations.map((item) => (
              <article className="rounded-xl border p-4" key={item.id}>
                <h3 className="font-semibold">{item.post_title ?? "Your business"}</h3>
                <p className="mt-2">
                  {item.label} · {item.organisation_name}
                </p>
                <Link
                  className="mt-2 inline-block underline"
                  href={`/organisation/${item.organisation_slug}`}
                >
                  View organisation
                </Link>
              </article>
            ))}
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Applications</h2>
            {!data.links.applications.length && <p>No applications yet.</p>}
            {data.links.applications.map((item) => (
              <article key={item.id} className="space-y-3 rounded-xl border p-4">
                <h3 className="font-semibold">
                  {item.post_title ?? "Your business"} · {item.organisation_name}
                </h3>
                <p>{item.status.replaceAll("_", " ")}</p>
                {item.info_request && <p className="whitespace-pre-wrap">{item.info_request}</p>}
                {item.status === "more_info_required" && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void run(() =>
                        updateMyFoundationApplication(getFoundationBrowserClient(), {
                          application_id: item.id,
                          action: "respond",
                          response: String(form.get("response")),
                        })
                      );
                    }}
                  >
                    <label>
                      Additional information
                      <textarea
                        required
                        minLength={2}
                        maxLength={2000}
                        name="response"
                        className="mt-2 w-full rounded-lg border bg-background p-3"
                      />
                    </label>
                    <button disabled={busy} className="mt-2 rounded-lg border px-4 py-2">
                      Send response
                    </button>
                  </form>
                )}
                {["submitted", "more_info_required"].includes(item.status) && (
                  <button
                    disabled={busy}
                    className="underline"
                    onClick={() =>
                      void run(() =>
                        updateMyFoundationApplication(getFoundationBrowserClient(), {
                          application_id: item.id,
                          action: "withdraw",
                        })
                      )
                    }
                  >
                    Withdraw application
                  </button>
                )}
              </article>
            ))}
          </section>
          <section className="space-y-4 rounded-xl border bg-card p-5">
            <h2 className="text-lg font-semibold">Apply to an organisation</h2>
            <p className="text-sm text-muted-foreground">
              Your business title, category, area and verified representative details are shared
              with its administrators. Verification is required. You choose whether to share your
              representative name.
            </p>
            {!data.posts.length ? (
              <Link className="underline" href="/post/create-business">
                Create a business post first
              </Link>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(async () => {
                    const api = getFoundationBrowserClient();
                    const org = await readFoundationPublicOrganisation(api, {
                      slug: String(form.get("organisation")),
                    });
                    if (!org) throw new Error();
                    return applyToFoundationOrganisation(api, {
                      organisation_id: org.id,
                      post_id: String(form.get("post")),
                      share_representative_name: form.get("share_name") === "on",
                      consent: form.get("consent") === "on",
                      ...(String(form.get("reason")).trim()
                        ? { reason: String(form.get("reason")) }
                        : {}),
                    });
                  });
                }}
              >
                <label className="block">
                  Organisation
                  <select
                    name="organisation"
                    required
                    defaultValue={preselected ?? ""}
                    className="mt-2 w-full rounded-lg border bg-background p-3"
                  >
                    <option value="">Choose an organisation</option>
                    {data.directory
                      .filter((item) => item.accepting_applications)
                      .map((item) => (
                        <option key={item.slug} value={item.slug}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block">
                  Your business
                  <select
                    name="post"
                    required
                    className="mt-2 w-full rounded-lg border bg-background p-3"
                  >
                    {data.posts.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title ?? "Untitled business"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  Reason or programme details
                  <textarea
                    name="reason"
                    maxLength={1000}
                    className="mt-2 w-full rounded-lg border bg-background p-3"
                  />
                </label>
                <label className="flex gap-2">
                  <input type="checkbox" name="share_name" />
                  Share my verified representative name
                </label>
                <label className="flex gap-2">
                  <input type="checkbox" name="consent" required />I consent to sharing these
                  details with this organisation.
                </label>
                <button
                  disabled={busy}
                  className="rounded-lg bg-primary px-4 py-3 text-primary-foreground"
                >
                  Apply
                </button>
              </form>
            )}
          </section>
          {data.sponsorships.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Sponsored posting places</h2>
              {data.sponsorships.map((item) => (
                <article key={item.id} className="rounded-xl border p-4">
                  <h3 className="font-semibold">{item.business_name ?? "Your business"}</h3>
                  <p>
                    {item.organisation_name} · {item.status}
                    {item.ends_at &&
                      ` · Ends ${new Date(item.ends_at).toLocaleDateString("en-ZA")}`}
                  </p>
                </article>
              ))}
            </section>
          )}
          {data.links.administers.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Organisations you administer</h2>
              {data.links.administers.map((item) => (
                <p key={item.organisation_id}>
                  <Link
                    className="underline"
                    href={`/dashboard/organisation/${item.organisation_slug}`}
                  >
                    {item.organisation_name}
                  </Link>
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
