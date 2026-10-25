"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
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
  const user = useAuthStore((state) => state.user);
  const [queue, setQueue] = useState<z.infer<typeof queueSchema>>([]);
  const [lease, setLease] = useState<z.infer<typeof claimSchema> | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [documents, setDocuments] = useState<{ id: string; url: string; mime: string }[]>([]);
  const [numberMatches, setNumberMatches] = useState(false);
  const [selfieMatches, setSelfieMatches] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setQueue(await fetchReviewQueue());
  }
  useEffect(() => {
    fetchReviewQueue()
      .then(setQueue)
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "The queue could not be loaded")
      );
  }, []);
  useEffect(
    () => () => documents.forEach((document) => URL.revokeObjectURL(document.url)),
    [documents]
  );
  async function command(body: object) {
    await ensureCsrfTokenReady();
    const response = await fetch("/api/foundation/verification/review", {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.error === "string" ? data.error : "The case could not be updated"
      );
    return data;
  }
  async function open(caseId: string) {
    setBusy(true);
    setMessage("");
    setContext(null);
    setDocuments([]);
    setNumberMatches(false);
    setSelfieMatches(false);
    const created: typeof documents = [];
    try {
      const claimed = claimSchema.parse(await command({ action: "claim", case_id: caseId }));
      setLease(claimed);
      const keys = {
        case_id: claimed.case_id,
        claim_generation: claimed.claim_generation,
        claim_nonce: claimed.claim_nonce,
      };
      const data: Context = await command({ action: "context", ...keys });
      if (data.case_id !== caseId || !/^\d{13}$/.test(data.claimed_number))
        throw new Error("Review context could not be verified");
      for (const artifact of [data.id_artifact_id, data.selfie_artifact_id]) {
        const response = await fetch("/api/foundation/verification/evidence", {
          method: "POST",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ ...keys, artifact_id: artifact }),
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error("A document could not be opened. The claim may have expired.");
        const blob = await response.blob();
        if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(blob.type))
          throw new Error("Unsupported evidence type");
        created.push({ id: artifact, url: URL.createObjectURL(blob), mime: blob.type });
      }
      setDocuments(created);
      setContext(data);
    } catch (error) {
      created.forEach((document) => URL.revokeObjectURL(document.url));
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
      setMessage(
        result.status === "awaiting_second_reviewer"
          ? "Your review is recorded. An independent reviewer must approve this higher-risk case."
          : action === "return"
            ? "The member has been asked to resubmit."
            : "Identity review completed."
      );
      setContext(null);
      setLease(null);
      setDocuments([]);
      setReason("");
      await refresh();
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
            onClick={async () => {
              setBusy(true);
              try {
                await command({
                  action: "release",
                  case_id: lease.case_id,
                  claim_generation: lease.claim_generation,
                  claim_nonce: lease.claim_nonce,
                });
                setContext(null);
                setLease(null);
                setDocuments([]);
              } catch (error) {
                setMessage(
                  error instanceof Error ? error.message : "The claim could not be released"
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Release case
          </button>
        </section>
      )}
      <div className="space-y-3">
        {queue.length === 0 && (
          <p className="rounded-xl border p-6 text-muted-foreground">
            No identity submissions are waiting for review.
          </p>
        )}
        {queue.map((item) => (
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
                    item.proposed_by === user?.id ||
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
                      setMessage("Independent review approved.");
                      await refresh();
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
