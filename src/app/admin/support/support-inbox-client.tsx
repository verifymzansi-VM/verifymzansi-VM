"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import type { SupportSubmission } from "./page";
import { supportReference } from "@/lib/contact-email";
import { Input } from "@/components/ui/input";

type StatusFilter = "all" | "new" | "in_progress" | "resolved";

const STATUS_FILTERS: readonly StatusFilter[] = ["all", "new", "in_progress", "resolved"];

const STATUS_BADGE: Record<
  SupportSubmission["status"],
  { variant: "destructive" | "secondary" | "outline"; label: string }
> = {
  new: { variant: "destructive", label: "New" },
  in_progress: { variant: "secondary", label: "In progress" },
  resolved: { variant: "outline", label: "Resolved" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SupportInboxClient({ submissions }: { submissions: SupportSubmission[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const filtered = submissions.filter(
    (s) =>
      (filter === "all" || s.status === filter) &&
      `${s.id} ${supportReference(s.id)} ${s.name} ${s.email} ${s.message}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
  );

  async function updateStatus(id: string, status: SupportSubmission["status"]) {
    setPendingId(id);
    setError("");
    try {
      const res = await fetch("/api/admin/support/update", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ submissionId: id, status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update submission");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Input
        aria-label="Search requests on this page"
        placeholder="Search this page by reference, email or message"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {/* Status filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((s) => {
          const count =
            s === "all" ? submissions.length : submissions.filter((r) => r.status === s).length;
          return (
            <Button
              key={s}
              size="sm"
              variant={filter === s ? "default" : "outline"}
              onClick={() => setFilter(s)}
              className="capitalize"
            >
              {s.replace("_", " ")}
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {count}
              </Badge>
            </Button>
          );
        })}
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No submissions with this status.
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((sub) => {
            const badge = STATUS_BADGE[sub.status] ?? STATUS_BADGE.new;
            const busy = pendingId === sub.id;
            return (
              <li key={sub.id} id={sub.id} className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{sub.name}</p>
                    <a
                      href={`mailto:${encodeURIComponent(sub.email)}?subject=${encodeURIComponent(`Re: VerifyMzansi request (${supportReference(sub.id)})`)}`}
                      className="truncate text-xs text-primary hover:underline"
                    >
                      {sub.email}
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(sub.created_at)}
                    </span>
                  </div>
                </div>
                <p className="break-all text-xs text-muted-foreground">
                  Reference: {supportReference(sub.id)}
                </p>

                <p className="whitespace-pre-wrap text-sm text-foreground/90">{sub.message}</p>
                <div className="text-xs text-muted-foreground space-y-1">
                  {sub.emailActivity?.length ? (
                    sub.emailActivity.map((event, index) => (
                      <p key={`${event.created_at}-${index}`}>
                        {event.template === "support_acknowledgement"
                          ? "Sender acknowledgement"
                          : "Team email alert"}
                        :{" "}
                        {event.accepted
                          ? "Accepted by email provider; inbox delivery unconfirmed"
                          : "Send failed"}
                      </p>
                    ))
                  ) : (
                    <p>
                      No recorded email notification. Older requests may have been saved without
                      sending an email.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {sub.status !== "in_progress" && sub.status !== "resolved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => updateStatus(sub.id, "in_progress")}
                    >
                      Mark in progress
                    </Button>
                  )}
                  {sub.status !== "resolved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => updateStatus(sub.id, "resolved")}
                    >
                      Mark resolved
                    </Button>
                  )}
                  {sub.status === "resolved" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => updateStatus(sub.id, "new")}
                    >
                      Reopen
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
