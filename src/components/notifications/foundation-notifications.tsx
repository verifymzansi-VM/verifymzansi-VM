"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";
import { foundationNotificationPageSchema } from "@/lib/foundation/owner-inbox";
import { createTimeoutFetch } from "@/lib/supabase/fetch-with-timeout";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { formatSaLongDate } from "@/lib/utils/format";
import type { z } from "zod";

const titles = {
  enquiry_received: "New enquiry",
  organisation_application_received: "New organisation application",
  organisation_application_decided: "Organisation application updated",
  organisation_affiliation_ended: "Organisation affiliation ended",
  organisation_sponsorship_activated: "Sponsorship activated",
  organisation_sponsorship_ended: "Sponsorship ended",
  partner_commission_approved: "Partner commission approved",
  partner_commission_reversed: "Partner commission reversed",
} as const;
type Page = z.infer<typeof foundationNotificationPageSchema>;
export function FoundationNotifications() {
  const accountId = useAuthStore((state) => state.user?.id);
  return <FoundationNotificationList key={accountId ?? "anonymous"} accountId={accountId} />;
}

function FoundationNotificationList({ accountId }: { accountId: string | undefined }) {
  const [page, setPage] = useState<Page | null>(null);
  const [cursor, setCursor] = useState<Page["next_cursor"]>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!accountId) return;
    const query = new URLSearchParams({ limit: "25" });
    if (cursor) {
      query.set("before_created", cursor.before_created);
      query.set("before_id", cursor.before_id);
    }
    void createTimeoutFetch()(`/api/foundation/notifications?${query}`, {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const payload = await response.json();
        if (payload.account_id !== accountId) throw new Error();
        const next = foundationNotificationPageSchema.parse(payload.data);
        if (!cancelled && useAuthStore.getState().user?.id === accountId) setPage(next);
      })
      .catch(() => {
        if (!cancelled) setError("Notifications could not be loaded. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, cursor, revision]);
  async function markRead() {
    if (busy || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await ensureCsrfTokenReady())) throw new Error();
      const response = await createTimeoutFetch()("/api/foundation/notifications", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: "{}",
      });
      if (!response.ok) throw new Error();
      if (useAuthStore.getState().user?.id === accountId) setRevision((value) => value + 1);
    } catch {
      if (useAuthStore.getState().user?.id === accountId)
        setError("Notifications could not be marked read. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4" aria-label="Your notifications">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>{page ? `${page.unread_count} unread` : "Loading notifications…"}</p>
        <Button
          variant="outline"
          disabled={busy || !page?.unread_count}
          onClick={() => void markRead()}
        >
          Mark all read
        </Button>
      </div>
      {error && (
        <div>
          <p role="alert">{error}</p>
          <Button onClick={() => setRevision((value) => value + 1)}>Retry</Button>
        </div>
      )}
      {page?.items.length === 0 && <p>No notifications yet.</p>}
      {page?.items.map((item) => (
        <article key={item.id} className="space-y-1 border-b py-4">
          <h2 className="font-semibold">
            {titles[item.kind]}
            {!item.read_at && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">Unread</span>
            )}
          </h2>
          {item.post_title && <p>{item.post_title}</p>}
          {item.organisation_name && <p>{item.organisation_name}</p>}
          <p className="text-sm text-muted-foreground">{formatSaLongDate(item.created_at)}</p>
        </article>
      ))}
      <div className="flex gap-3">
        {cursor && (
          <Button variant="outline" onClick={() => setCursor(null)}>
            Latest
          </Button>
        )}
        {page?.next_cursor && (
          <Button variant="outline" onClick={() => setCursor(page.next_cursor)}>
            Older notifications
          </Button>
        )}
      </div>
    </section>
  );
}
