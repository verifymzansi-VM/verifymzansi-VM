"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { useAuthStore } from "@/stores/auth-store";
import { useFoundationInboxCounts } from "@/hooks/use-foundation-inbox-counts";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
const row = z.object({
  id: z.uuid(),
  post_id: z.uuid(),
  post_kind: z.enum(["listing", "business", "event"]),
  post_title: z.string().nullable(),
  buyer_name: z.string().nullable(),
  buyer_email: z.string(),
  buyer_phone: z.string().nullable(),
  email_confirmed: z.boolean(),
  message: z.string(),
  status: z.enum(["new", "read", "contacted", "closed"]),
  created_at: z.string(),
  updated_at: z.string(),
});
const cursorSchema = z.object({ before_created: z.string(), before_id: z.uuid() });
const pageSchema = z.object({
  items: z.array(row).max(50),
  unread_count: z.number().int().nonnegative(),
  next_cursor: cursorSchema.nullable(),
});
export function FoundationEnquiries() {
  const accountId = useAuthStore((state) => state.user?.id);
  return <FoundationEnquiryList key={accountId ?? "anonymous"} />;
}
function FoundationEnquiryList() {
  const accountId = useAuthStore((state) => state.user?.id);
  const counts = useFoundationInboxCounts();
  const [page, setPage] = useState<z.infer<typeof pageSchema>>();
  const [cursor, setCursor] = useState<z.infer<typeof cursorSchema> | null>(null);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!accountId) return;
    const query = new URLSearchParams({ limit: "25" });
    if (cursor) {
      query.set("before_created", cursor.before_created);
      query.set("before_id", cursor.before_id);
    }
    void fetch(`/api/foundation/enquiries?${query}`, { cache: "no-store", redirect: "error" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const payload = await response.json();
        if (payload.account_id !== accountId) throw new Error();
        const data = pageSchema.parse(payload.data);
        if (!cancelled && useAuthStore.getState().user?.id === accountId) setPage(data);
      })
      .catch(() => {
        if (!cancelled) setMessage("Your enquiries could not be loaded. Try refreshing.");
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, cursor, version, counts?.unread_enquiries]);
  async function update(id: string, status: "read" | "contacted" | "closed") {
    setBusy(true);
    setMessage("");
    try {
      await ensureCsrfTokenReady();
      const response = await fetch("/api/foundation/enquiries", {
        method: "PATCH",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id, status }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      setVersion((value) => value + 1);
    } catch {
      setMessage("The status could not be changed. Refresh before trying again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Buyer enquiries</h1>
        <p className="mt-2 text-muted-foreground">
          Messages sent to your posts are visible only to you.
        </p>
      </header>
      {message && (
        <p role="status" className="rounded-xl border p-4">
          {message}
        </p>
      )}
      <button
        className="rounded-lg border px-4 py-3"
        disabled={busy}
        onClick={() => setVersion((value) => value + 1)}
      >
        Refresh enquiries
      </button>
      {!accountId && (
        <p>
          <Link className="underline" href="/login">
            Sign in
          </Link>{" "}
          to read your messages.
        </p>
      )}
      {page?.items.length === 0 && (
        <p className="rounded-2xl border bg-card p-6 text-muted-foreground">
          No enquiries on this page yet.
        </p>
      )}
      <div className="space-y-4">
        {page?.items.map((item) => (
          <article key={item.id} className="space-y-3 rounded-2xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{item.post_title ?? "Your post"}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.buyer_name ?? "Visitor"} ·{" "}
                  {new Date(item.created_at).toLocaleString("en-ZA")}
                </p>
              </div>
              <label className="text-sm">
                Enquiry status
                <select
                  value={item.status}
                  disabled={busy}
                  className="ml-2 rounded-lg border bg-background p-2"
                  onChange={(event) => {
                    if (["read", "contacted", "closed"].includes(event.target.value))
                      void update(item.id, event.target.value as "read" | "contacted" | "closed");
                  }}
                >
                  {item.status === "new" && (
                    <option value="new" disabled>
                      New
                    </option>
                  )}
                  <option value="read">Read</option>
                  <option value="contacted">Contacted</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
            </div>
            <p className="whitespace-pre-wrap">{item.message}</p>
            <div className="flex flex-wrap gap-4 text-sm">
              <a
                className="text-primary underline"
                href={`mailto:${encodeURIComponent(item.buyer_email)}`}
              >
                Reply by email
              </a>
              <span className="text-muted-foreground">
                {item.email_confirmed ? "Email confirmed" : "Reply email is unconfirmed"}
              </span>
              {item.buyer_phone && (
                <a className="text-primary underline" href={`tel:${item.buyer_phone}`}>
                  Call buyer
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
      <nav aria-label="Enquiry pages" className="flex gap-4">
        {cursor && (
          <button className="underline" onClick={() => setCursor(null)}>
            Newest enquiries
          </button>
        )}
        {page?.next_cursor && (
          <button className="underline" onClick={() => setCursor(page.next_cursor)}>
            Older enquiries
          </button>
        )}
      </nav>
    </div>
  );
}
