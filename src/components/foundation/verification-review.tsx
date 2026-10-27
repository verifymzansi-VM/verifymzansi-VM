"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAuthStore } from "@/stores/auth-store";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import type { readFoundationReviewContext } from "@/lib/foundation/verification-runtime";
const queueSchema = z
  .array(
    z.strictObject({
      case_id: z.uuid(),
      version: z.number().int().positive(),
      display_name: z.string().nullable(),
      submitted_at: z.string(),
      risk_score: z.number().int().min(0).max(100),
      decision_id: z.uuid().nullable(),
      proposed_by: z.uuid().nullable(),
    })
  )
  .max(25);
const claimSchema = z.object({
  case_id: z.uuid(),
  claim_generation: z.string(),
  claim_nonce: z.uuid(),
  claim_expires_at: z.string(),
});
type Context = Awaited<ReturnType<typeof readFoundationReviewContext>>;
async function fetchReviewQueue() {
  const response = await fetch("/api/foundation/verification/review", {
    cache: "no-store",
    redirect: "error",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(typeof data.error === "string" ? data.error : "The queue could not be loaded");
  return queueSchema.parse(data);
}
export function FoundationVerificationReview() {
  const current = useAuthStore((state) => state.foundationContext);
  const userId = useAuthStore((state) => state.user?.id);
  const loading = useAuthStore((state) => state.isLoading);
  if (loading) return <p role="status">Loading your reviewer account…</p>;
  const assigned = current?.staff?.assigned_capabilities ?? [];
  if (
    !current ||
    current.account_id !== userId ||
    !current.staff?.can_access ||
    !assigned.includes("case:claim") ||
    !assigned.includes("evidence:view")
  )
    return (
      <p role="alert">A current reviewer assignment and authenticator verification are required.</p>
    );
  // Losing the current assignment unmounts the private viewer and revokes all
  // object URLs, even if the presentation role still says admin or governor.
  return <FoundationVerificationViewer key={current.account_id} viewerId={current.account_id} />;
}

function FoundationVerificationViewer({ viewerId }: { viewerId: string }) {
  const [queue, setQueue] = useState<z.infer<typeof queueSchema> | null>(null);
  const [lease, setLease] = useState<z.infer<typeof claimSchema> | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [documents, setDocuments] = useState<{ id: string; url: string; mime: string }[]>([]);
  const [numberMatches, setNumberMatches] = useState(false);
  const [selfieMatches, setSelfieMatches] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const objectUrls = useRef(new Set<string>());
  function clearEvidence() {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
    setDocuments([]);
  }
  function clearReview() {
    setContext(null);
    setLease(null);
    clearEvidence();
    setNumberMatches(false);
    setSelfieMatches(false);
    setReason("");
  }
  async function refresh() {
    setQueue(null);
    setQueue(await fetchReviewQueue());
  }
  async function refreshAfterUpdate(receipt: string) {
    if (!mounted.current) return;
    setMessage(receipt);
    try {
      await refresh();
    } catch {
      if (mounted.current)
        setMessage(
          `${receipt} The queue could not be reloaded; refresh it before doing more work.`
        );
    }
  }
  useEffect(() => {
    fetchReviewQueue()
      .then(setQueue)
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "The queue could not be loaded")
      );
  }, []);
  useEffect(() => {
    mounted.current = true;
    const urls = objectUrls.current;
    return () => {
      mounted.current = false;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);
  async function command(body: object) {
    if (!(await ensureCsrfTokenReady()))
      throw new Error("Refresh the security check before continuing.");
    if (!mounted.current) throw new Error("Review closed");
    const response = await fetch("/api/foundation/verification/review", {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        setContext(null);
        clearEvidence();
        setNumberMatches(false);
        setSelfieMatches(false);
      }
      throw new Error(
        typeof data.error === "string" ? data.error : "The case could not be updated"
      );
    }
    return data;
  }
  async function open(caseId: string) {
    if (!mounted.current || busy) return;
    setBusy(true);
    setMessage("");
    setContext(null);
    clearEvidence();
    setNumberMatches(false);
    setSelfieMatches(false);
    const created: typeof documents = [];
    try {
      const claimed = claimSchema.parse(await command({ action: "claim", case_id: caseId }));
      if (!mounted.current) throw new Error("Review closed");
      setLease(claimed);
      const keys = {
        case_id: claimed.case_id,
        claim_generation: claimed.claim_generation,
        claim_nonce: claimed.claim_nonce,
      };
      const data: Context = await command({ action: "context", ...keys });
      if (!mounted.current) throw new Error("Review closed");
      if (data.case_id !== caseId || !/^\d{13}$/.test(data.claimed_number))
        throw new Error("Review context could not be verified");
      for (const artifact of [data.id_artifact_id, data.selfie_artifact_id]) {
        const response = await fetch("/api/foundation/verification/evidence", {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ ...keys, artifact_id: artifact }),
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error("A document could not be opened. The claim may have expired.");
        const blob = await response.blob();
        if (!mounted.current) throw new Error("Review closed");
        if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(blob.type))
          throw new Error("Unsupported evidence type");
        const url = URL.createObjectURL(blob);
        objectUrls.current.add(url);
        created.push({ id: artifact, url, mime: blob.type });
      }
      setDocuments(created);
      setContext(data);
    } catch (error) {
      for (const document of created) {
        URL.revokeObjectURL(document.url);
        objectUrls.current.delete(document.url);
      }
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : "Evidence could not be opened");
    } finally {
      setBusy(false);
    }
  }
  async function decide(action: "review" | "return") {
    if (!context || !lease) return;
    setBusy(true);
    setMessage("");
    try {
      const keys = {
        case_id: context.case_id,
        claim_generation: lease.claim_generation,
        claim_nonce: lease.claim_nonce,
        expected_version: context.case_version,
      };
      const result = await command(
        action === "review"
          ? {
              action,
              ...keys,
              submission_id: context.submission_id,
              number_matches: numberMatches,
              selfie_matches: selfieMatches,
            }
          : { action, ...keys, reason }
      );
      const receipt =
        result.status === "awaiting_second_reviewer"
          ? "Your review is recorded. An independent reviewer must approve this higher-risk case."
          : action === "return"
            ? "The member has been asked to resubmit."
            : "Identity review completed.";
      clearReview();
      await refreshAfterUpdate(receipt);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The decision could not be confirmed. Refresh the queue before trying again."
      );
    } finally {
      setBusy(false);
    }
  }
  async function releaseCase() {
    if (!lease || busy) return;
    setBusy(true);
    try {
      await command({
        action: "release",
        case_id: lease.case_id,
        claim_generation: lease.claim_generation,
        claim_nonce: lease.claim_nonce,
      });
      clearReview();
      await refreshAfterUpdate("Claim released.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The claim could not be released");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Identity review</h1>
          <p className="mt-2 text-muted-foreground">
            Only review the claimed case. Every evidence view is recorded. Higher-risk cases require
            two independent reviewers.
          </p>
        </div>
        <Link href="/staff/two-step" className="underline">
          Refresh authenticator verification
        </Link>
      </header>
      {message && (
        <p role="status" className="rounded-xl border p-4">
          {message}
        </p>
      )}
      <button
        disabled={busy}
        onClick={() => void refresh().catch((error) => setMessage(error.message))}
        className="rounded-lg border px-4 py-3"
      >
        Refresh queue
      </button>
      {context && lease && (
        <section className="space-y-5 rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-semibold">
            Compare the declared identity with both documents
          </h2>
          <p>
            Claim expires {new Date(lease.claim_expires_at).toLocaleTimeString("en-ZA")}. Risk
            score: {context.risk_score}/100.
          </p>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Declared legal names</dt>
              <dd className="font-semibold">
                {context.claimed_names.first_name} {context.claimed_names.last_name}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Declared ID number</dt>
              <dd className="font-mono">{context.claimed_number}</dd>
            </div>
          </dl>
          <div className="grid gap-5 lg:grid-cols-2">
            {documents.map((document, index) => (
              <figure key={document.id}>
                <figcaption className="mb-2 font-semibold">
                  {index === 0 ? "Identity document" : "Selfie"}
                </figcaption>
                {document.mime === "application/pdf" ? (
                  <iframe
                    src={document.url}
                    title="Identity document"
                    sandbox=""
                    className="h-[500px] w-full rounded-lg border"
                  />
                ) : (
                  <Image
                    src={document.url}
                    unoptimized
                    width={1000}
                    height={750}
                    alt={index === 0 ? "Claimed identity document" : "Claimed selfie"}
                    className="h-auto w-full rounded-lg border"
                  />
                )}
              </figure>
            ))}
          </div>
          <label className="flex gap-3">
            <input
              type="checkbox"
              checked={numberMatches}
              onChange={(event) => setNumberMatches(event.target.checked)}
            />
            <span>
              I independently checked that the exact ID number and declared legal names match the
              identity document.
            </span>
          </label>
          <label className="flex gap-3">
            <input
              type="checkbox"
              checked={selfieMatches}
              onChange={(event) => setSelfieMatches(event.target.checked)}
            />
            <span>I independently checked that the document portrait matches the selfie.</span>
          </label>
          <button
            disabled={busy || !numberMatches || !selfieMatches}
            onClick={() => void decide("review")}
            className="rounded-lg bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50"
          >
            Record review
          </button>
          <div className="space-y-2 border-t pt-4">
            <label className="block">
              Resubmission reason
              <textarea
                minLength={5}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="mt-2 w-full rounded-lg border bg-background p-3"
              />
            </label>
            <button
              disabled={busy || reason.trim().length < 5}
              onClick={() => void decide("return")}
              className="rounded-lg border px-4 py-3"
            >
              Ask member to resubmit
            </button>
          </div>
          <button
            disabled={busy}
            className="rounded-lg border px-4 py-3"
            onClick={() => void releaseCase()}
          >
            Release case
          </button>
        </section>
      )}
      {lease && !context && (
        <section className="space-y-3 rounded-lg border p-4">
          <p>A case is claimed, but its evidence is not open.</p>
          <button
            disabled={busy}
            onClick={() => void releaseCase()}
            className="rounded-lg border px-4 py-3"
          >
            Release case
          </button>
        </section>
      )}
      <div className="space-y-3">
        {queue === null && !message && <p role="status">Loading the review queue…</p>}
        {queue?.length === 0 && (
          <p className="rounded-xl border p-6 text-muted-foreground">
            No identity submissions are waiting for review.
          </p>
        )}
        {(queue ?? []).map((item) => (
          <article
            key={item.case_id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4"
          >
            <div>
              <h2 className="font-semibold">{item.display_name ?? "Member"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Submitted {new Date(item.submitted_at).toLocaleString("en-ZA")} · Risk{" "}
                {item.risk_score}/100
              </p>
            </div>
            <div className="flex gap-3">
              <button
                disabled={busy}
                onClick={() => void open(item.case_id)}
                className="rounded-lg border px-4 py-3"
              >
                Claim and review
              </button>
              {item.decision_id && (
                <button
                  disabled={
                    busy ||
                    item.proposed_by === viewerId ||
                    context?.case_id !== item.case_id ||
                    !lease ||
                    !numberMatches ||
                    !selfieMatches ||
                    documents.length !== 2
                  }
                  className="rounded-lg bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      if (!context || !lease) return;
                      await command({
                        action: "approve",
                        decision_id: item.decision_id,
                        case_id: context.case_id,
                        claim_generation: lease.claim_generation,
                        claim_nonce: lease.claim_nonce,
                        expected_version: context.case_version,
                        number_matches: numberMatches,
                        selfie_matches: selfieMatches,
                      });
                      clearReview();
                      await refreshAfterUpdate("Independent review approved.");
                    } catch (error) {
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : "The decision could not be confirmed"
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Approve independent review
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
