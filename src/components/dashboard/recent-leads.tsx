import Link from "next/link";
import { ChevronRight, MessageSquare } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

export interface RecentLead {
  id: string;
  status: string;
  message: string | null;
  buyer_name: string | null;
  created_at: string;
  target_type: string;
  /** Title of the post the enquiry is about, when known. */
  title?: string | null;
}

interface RecentLeadsProps {
  leads: RecentLead[];
  /** Whether the member has any posts yet (changes the empty-state action). */
  hasPosts: boolean;
}

function initials(name: string | null) {
  const clean = (name ?? "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

/** Latest enquiries on the overview. Rendered on the server only. */
export function RecentLeads({ leads, hasPosts }: RecentLeadsProps) {
  return (
    <section
      aria-labelledby="recent-leads-title"
      className="rounded-2xl border border-border/70 bg-card elev-xs"
    >
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4 sm:px-5">
        <h2 id="recent-leads-title" className="font-display text-base font-semibold">
          Recent leads
        </h2>
        {leads.length > 0 ? (
          <Link
            href="/dashboard/leads"
            className="link-arrow min-h-11 px-1 text-sm"
            aria-label="See all leads"
          >
            See all
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        ) : null}
      </div>

      {leads.length === 0 ? (
        <div className="px-4 pb-5 pt-2 text-center sm:px-5">
          <span aria-hidden="true" className="empty-state-icon h-11 w-11 rounded-xl">
            <MessageSquare className="h-5 w-5" />
          </span>
          <p className="mt-3 text-sm font-semibold text-foreground">No leads yet</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
            {hasPosts
              ? "Enquiries on your posts show up here."
              : "Post something to get enquiries."}
          </p>
          {!hasPosts ? (
            <Link href="/post/create" className="link-arrow mt-3 min-h-11 px-1">
              Post an item
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-border/60 px-2 pb-2 sm:px-3">
          {leads.map((lead) => {
            const isNew = lead.status === "new";
            const about =
              lead.title || (lead.target_type === "promotion" ? "your event post" : "your post");
            return (
              <li key={lead.id}>
                <Link
                  href="/dashboard/leads"
                  className="flex items-start gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      isNew
                        ? "bg-brand-gold-100 text-brand-gold-900 dark:bg-brand-gold-400/15 dark:text-brand-gold-200"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {initials(lead.buyer_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {lead.buyer_name || "A buyer"}
                      </span>
                      {isNew ? (
                        <span className="shrink-0 rounded-full bg-brand-gold-100 px-2 py-0.5 text-[11px] font-semibold text-brand-gold-900 dark:bg-brand-gold-400/15 dark:text-brand-gold-200">
                          New
                        </span>
                      ) : null}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {formatRelativeTime(lead.created_at)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      About {about}
                    </span>
                    {lead.message ? (
                      <span className="mt-1 line-clamp-2 block text-sm text-foreground/80">
                        {lead.message}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
