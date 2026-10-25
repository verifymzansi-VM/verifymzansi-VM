"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { z } from "zod";
import { getFoundationBrowserClient } from "@/lib/foundation/browser-client";
import { foundationMediaUrl } from "@/lib/foundation/public-cards";
const claimSchema = z.looseObject({
  subject: z.enum(["post", "report"]),
  id: z.uuid(),
  claim_generation: z.string(),
  claim_nonce: z.uuid(),
  claim_expires_at: z.string(),
});
const media = z.object({
  object_key: z.string().regex(/^media\/[a-f0-9-]{36}$/),
  kind: z.enum(["image", "video"]),
});
const postSchema = z.looseObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  kind: z.string(),
  area: z.string(),
  category: z.string(),
  locality: z.string().nullable(),
  price_mode: z.string().nullable(),
  price_cents: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()).nullable(),
  media: z.array(media).max(100),
});
const reportedEvent = z.object({
  id: z.uuid(),
  reported_revision: z.number().int().positive(),
  current: z
    .object({
      title: z.string(),
      description: z.string(),
      revision: z.number().int().positive(),
      locality: z.string(),
      event_window: z.object({ starts_at: z.string(), ends_at: z.string() }),
    })
    .nullable(),
});
const reportSchema = z.union([
  z.object({
    id: z.uuid(),
    description: z.string(),
    category: z.string(),
    severity: z.string(),
    post: postSchema.nullable(),
  }),
  z.object({
    id: z.uuid(),
    origin: z.literal("staff"),
    category: z.literal("duplicate_event"),
    description: z.string(),
    post_a: reportedEvent,
    post_b: reportedEvent,
  }),
]);
async function readHeldClaims(mode: "content" | "reports") {
  const result = await getFoundationBrowserClient().rpc("my_queue_claims", {});
  if (result.error) throw new Error("Your current claims could not be loaded");
  return z
    .array(claimSchema)
    .max(40)
    .parse(result.data)
    .filter((item) => item.subject === (mode === "content" ? "post" : "report"));
}
type Claim = z.infer<typeof claimSchema>;
export function FoundationModerationQueue({ mode }: { mode: "content" | "reports" }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [current, setCurrent] = useState<Claim>();
  const [post, setPost] = useState<z.infer<typeof postSchema> | null>(null);
  const [report, setReport] = useState<z.infer<typeof reportSchema> | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    void readHeldClaims(mode).then(
      (items) => {
        if (!cancelled) setClaims(items);
      },
      (error) => {
        if (!cancelled) setMessage(error.message);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [mode]);
  async function claim() {
    setBusy(true);
    setMessage("");
    try {
      const result = await getFoundationBrowserClient().rpc("claim_queue_items", {
        p_queue: mode,
        p_limit: 5,
      });
      if (result.error)
        throw new Error("A current staff session and authenticator code are required");
      const batch = z.array(claimSchema).max(5).parse(result.data);
      setClaims(await readHeldClaims(mode));
      if (!batch.length) setMessage("No unclaimed items are waiting in this queue.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The queue could not be claimed");
    } finally {
      setBusy(false);
    }
  }
  async function open(item: Claim) {
    setBusy(true);
    setMessage("");
    setReason("");
    setCurrent(undefined);
    setPost(null);
    setReport(null);
    try {
      const api = getFoundationBrowserClient();
      const result =
        item.subject === "post"
          ? await api.rpc("staff_review_post", {
              p_post_id: item.id,
              p_claim_generation: item.claim_generation,
              p_claim_nonce: item.claim_nonce,
            })
          : await api.rpc("staff_review_report", {
              p_report_id: item.id,
              p_claim_generation: item.claim_generation,
              p_claim_nonce: item.claim_nonce,
            });
      if (result.error)
        throw new Error("Your claim expired or permission changed. Refresh the queue.");
      if (item.subject === "post") setPost(postSchema.parse(result.data));
      else {
        const data = reportSchema.parse(result.data);
        setReport(data);
        setPost("post" in data ? data.post : null);
      }
      setCurrent(item);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The item could not be opened");
    } finally {
      setBusy(false);
    }
  }
  async function decide(decision: "approve" | "reject" | "resolved" | "dismissed") {
    if (!current) return;
    setBusy(true);
    setMessage("");
    try {
      const api = getFoundationBrowserClient();
      const result =
        current.subject === "post" && post
          ? await api.rpc("moderate_post", {
              p_post_id: post.id,
              p_expected_revision: post.revision,
              p_decision: decision,
              p_claim_generation: current.claim_generation,
              p_claim_nonce: current.claim_nonce,
              p_reason: reason.trim() || undefined,
            })
          : await api.rpc("resolve_report", {
              p_report_id: current.id,
              p_claim_generation: current.claim_generation,
              p_claim_nonce: current.claim_nonce,
              p_outcome: decision,
              p_note: reason.trim(),
            });
      if (result.error)
        throw new Error(
          "This decision could not be applied. Check the reason, claim, current revision and required reviewer authority."
        );
      setClaims((items) => items.filter((item) => item.id !== current.id));
      setCurrent(undefined);
      setPost(null);
      setReport(null);
      setMessage("Decision recorded.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The result could not be confirmed. Refresh before trying again."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold">
          {mode === "content" ? "Post moderation" : "Reported content"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          Claim an item before reviewing it. Every decision is checked against your current
          permissions and the post revision.
        </p>
        <Link className="mt-2 inline-block text-primary underline" href="/staff/two-step">
          Refresh authenticator verification
        </Link>
      </header>
      {message && (
        <p role="status" className="rounded-xl border p-4">
          {message}
        </p>
      )}
      <button disabled={busy} className="rounded-lg border px-4 py-3" onClick={() => void claim()}>
        Claim next five items
      </button>
      <div className="flex flex-wrap gap-3">
        {claims.map((item, index) => (
          <button
            key={item.id}
            disabled={busy}
            className="rounded-lg border px-4 py-3"
            onClick={() => void open(item)}
          >
            Review item {index + 1}
          </button>
        ))}
      </div>
      {current && (
        <section className="space-y-5 rounded-2xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            Claim expires {new Date(current.claim_expires_at).toLocaleTimeString("en-ZA")}
          </p>
          {report && (
            <div className="rounded-xl border p-4">
              <h2 className="font-semibold">
                Report: {report.category.replaceAll("_", " ")}
                {"severity" in report ? ` · ${report.severity}` : ""}
              </h2>
              <p className="mt-2 whitespace-pre-wrap">{report.description}</p>
              {"post_a" in report && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {[report.post_a, report.post_b].map((item) => (
                    <article key={item.id} className="space-y-2 rounded-lg border p-3">
                      <h3 className="font-semibold">
                        {item.current?.title ?? "Event no longer public"}
                      </h3>
                      <p className="text-sm">
                        Reported revision {item.reported_revision}
                        {item.current ? ` · Current revision ${item.current.revision}` : ""}
                      </p>
                      {item.current && (
                        <>
                          <p className="whitespace-pre-wrap">{item.current.description}</p>
                          <p>{item.current.locality}</p>
                          <p>
                            {new Date(item.current.event_window.starts_at).toLocaleString("en-ZA")}{" "}
                            – {new Date(item.current.event_window.ends_at).toLocaleString("en-ZA")}
                          </p>
                          <Link
                            className="underline"
                            href={`/tourism-events/${item.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open public event
                          </Link>
                        </>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
          {post && (
            <>
              <h2 className="text-2xl font-semibold">{post.title ?? "Untitled post"}</h2>
              <p className="text-sm text-muted-foreground">
                {post.area.replaceAll("_", " ")} · {post.category.replaceAll("_", " ")} ·{" "}
                {post.locality}
              </p>
              <p className="whitespace-pre-wrap">{post.description}</p>
              {post.price_mode && (
                <p>
                  {post.price_mode === "amount" && post.price_cents
                    ? new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
                        Number(post.price_cents) / 100
                      )
                    : post.price_mode.replaceAll("_", " ")}
                </p>
              )}
              {post.attributes && (
                <dl className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(post.attributes).map(([name, value]) => (
                    <div key={name}>
                      <dt className="text-sm text-muted-foreground">{name.replaceAll("_", " ")}</dt>
                      <dd>
                        {typeof value === "string" || typeof value === "number"
                          ? String(value)
                          : typeof value === "boolean"
                            ? value
                              ? "Yes"
                              : "No"
                            : Array.isArray(value)
                              ? value
                                  .filter(
                                    (item) => typeof item === "string" || typeof item === "number"
                                  )
                                  .join(", ")
                              : ""}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {post.media.map((item, index) => {
                  const url = foundationMediaUrl(item.object_key);
                  return (
                    url &&
                    (item.kind === "video" ? (
                      <video
                        key={item.object_key}
                        src={url}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full rounded-lg"
                      />
                    ) : (
                      <Image
                        key={item.object_key}
                        src={url}
                        width={800}
                        height={600}
                        alt={`Submitted media ${index + 1}`}
                        className="h-auto w-full rounded-lg"
                      />
                    ))
                  );
                })}
              </div>
            </>
          )}
          <label className="block">
            Decision note
            <textarea
              minLength={5}
              maxLength={500}
              className="mt-2 w-full rounded-lg border bg-background p-3"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            {current.subject === "post" ? (
              <>
                <button
                  disabled={busy}
                  className="rounded-lg bg-primary px-4 py-3 text-primary-foreground"
                  onClick={() => void decide("approve")}
                >
                  Approve
                </button>
                <button
                  disabled={busy || reason.trim().length < 5}
                  className="rounded-lg border px-4 py-3"
                  onClick={() => void decide("reject")}
                >
                  Reject with reason
                </button>
              </>
            ) : (
              <>
                <button
                  disabled={busy || reason.trim().length < 5}
                  className="rounded-lg bg-primary px-4 py-3 text-primary-foreground"
                  onClick={() => void decide("resolved")}
                >
                  Mark resolved
                </button>
                <button
                  disabled={busy || reason.trim().length < 5}
                  className="rounded-lg border px-4 py-3"
                  onClick={() => void decide("dismissed")}
                >
                  Dismiss with reason
                </button>
              </>
            )}
            <button
              disabled={busy}
              className="rounded-lg border px-4 py-3"
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await getFoundationBrowserClient().rpc("release_queue_claim", {
                    p_subject: current.subject,
                    p_id: current.id,
                    p_claim_generation: current.claim_generation,
                    p_claim_nonce: current.claim_nonce,
                  });
                  if (result.error) throw new Error();
                  setClaims((items) => items.filter((item) => item.id !== current.id));
                  setCurrent(undefined);
                  setPost(null);
                  setReport(null);
                } catch {
                  setMessage("The claim could not be released; refresh the queue.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Release claim
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
