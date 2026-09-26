"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils/format";
import { useRealtime } from "@/hooks/use-realtime";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { createClient } from "@/lib/supabase/client";
import { whatsappLink } from "@/lib/utils/contact-links";
import { cn } from "@/lib/utils";

const STATUS_TONES: Record<string, string> = {
  new: "bg-brand-gold-100 text-brand-gold-900 dark:bg-brand-gold-400/15 dark:text-brand-gold-200",
  read: "bg-muted text-muted-foreground",
  contacted:
    "bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-500/15 dark:text-brand-green-300",
  closed: "bg-muted text-muted-foreground",
};

export interface LeadRow {
  id: string;
  target_id: string;
  target_type: string;
  message: string;
  status: string;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone?: string | null;
  created_at: string;
  listings: { title: string } | null;
}

interface LeadsFeedProps {
  initialLeads: LeadRow[];
  ownerColumn: "owner_id" | "seller_id";
  ownerId: string;
}

function humanStatus(status: string): string {
  if (status === "new") return "New";
  if (status === "read") return "Read";
  if (status === "contacted") return "Contacted";
  if (status === "closed") return "Closed";
  // Never show a raw enum key (e.g. "spam_flagged") to members.
  const words = status.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown";
}

export function LeadsFeed({ initialLeads, ownerColumn, ownerId }: LeadsFeedProps) {
  const [leads, setLeads] = useState<LeadRow[]>(initialLeads);
  const [statusError, setStatusError] = useState("");
  const supabase = useMemo(() => createClient(), []);

  async function hydrateLeadTitle(leadId: string, targetId: string, targetType: string) {
    const relationTable = targetType === "promotion" ? "promotions" : "listings";
    const { data } = await supabase
      .from(relationTable)
      .select("title")
      .eq("id", targetId)
      .maybeSingle();

    const title = (data as { title?: string | null } | null)?.title;
    if (!title) {
      return;
    }

    setLeads((prev) =>
      prev.map((lead) => (lead.id === leadId ? { ...lead, listings: { title } } : lead))
    );
  }

  useRealtime({
    table: "leads",
    event: "*",
    filterColumn: ownerColumn,
    filterValue: ownerId,
    enabled: Boolean(ownerId),
    onEvent: (payload) => {
      const eventType = payload.eventType as string | undefined;
      const nextRow = (payload.new ?? null) as Partial<LeadRow> | null;
      const oldRow = (payload.old ?? null) as Partial<LeadRow> | null;

      if (eventType === "INSERT" && nextRow?.id) {
        const insertedLead: LeadRow = {
          id: nextRow.id,
          target_id: nextRow.target_id || "",
          target_type: nextRow.target_type || "listing",
          message: nextRow.message || "",
          status: nextRow.status || "new",
          buyer_name: nextRow.buyer_name || null,
          buyer_email: nextRow.buyer_email || null,
          buyer_phone: nextRow.buyer_phone || null,
          created_at: nextRow.created_at || new Date().toISOString(),
          listings: null,
        };

        setLeads((prev) => {
          if (prev.some((lead) => lead.id === insertedLead.id)) {
            return prev;
          }

          return [insertedLead, ...prev].slice(0, 50);
        });

        if (
          insertedLead.target_id &&
          (insertedLead.target_type === "listing" || insertedLead.target_type === "promotion")
        ) {
          void hydrateLeadTitle(insertedLead.id, insertedLead.target_id, insertedLead.target_type);
        }
      }

      if (eventType === "UPDATE" && nextRow?.id) {
        setLeads((prev) =>
          prev.map((lead) =>
            lead.id === nextRow.id
              ? {
                  ...lead,
                  status: nextRow.status || lead.status,
                  message: nextRow.message || lead.message,
                }
              : lead
          )
        );
      }

      if (eventType === "DELETE" && oldRow?.id) {
        setLeads((prev) => prev.filter((lead) => lead.id !== oldRow.id));
      }
    },
  });

  async function updateLeadStatus(leadId: string, nextStatus: "read" | "contacted" | "closed") {
    const previousLead = leads.find((lead) => lead.id === leadId);
    if (!previousLead || previousLead.status === nextStatus) {
      return;
    }

    setLeads((prev) =>
      prev.map((lead) => (lead.id === leadId ? { ...lead, status: nextStatus } : lead))
    );

    setStatusError("");
    try {
      const response = await fetch("/api/leads", {
        method: "PATCH",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id: leadId, status: nextStatus }),
      });

      if (!response.ok) throw new Error("Unable to update enquiry");
    } catch {
      setStatusError("Could not update this enquiry. Please try again.");
      setLeads((prev) =>
        prev.map((lead) => (lead.id === leadId ? { ...lead, status: previousLead.status } : lead))
      );
    }
  }

  if (!leads.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/60 px-5 py-10 text-center">
        <span aria-hidden="true" className="empty-state-icon">
          <MessageSquare className="h-6 w-6" />
        </span>
        <p className="mt-3 font-display text-base font-semibold text-foreground">No leads yet</p>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
          Buyer enquiries on your posts show up here.
        </p>
        <Button asChild variant="outline" className="mt-4 h-11 rounded-full px-5">
          <Link href="/dashboard/listings">View my posts</Link>
        </Button>
      </div>
    );
  }

  const newCount = leads.filter((lead) => lead.status === "new").length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {leads.length} lead{leads.length === 1 ? "" : "s"}
        {newCount > 0 ? `, ${newCount} new` : ""}
      </p>
      {statusError && (
        <p role="alert" className="text-sm text-destructive">
          {statusError}
        </p>
      )}
      <ul className="space-y-3">
        {leads.map((lead) => {
          const title = lead.listings?.title || "your post";
          const postPath = `/${lead.target_type === "promotion" ? "tourism-events" : "listing"}/${lead.target_id}`;
          const whatsappHref = whatsappLink(
            lead.buyer_phone,
            lead.listings?.title || "your enquiry",
            postPath,
            "Hi, thanks for your enquiry about"
          );
          const isNew = lead.status === "new";
          return (
            <li key={lead.id}>
              <Card
                className={cn(isNew && "border-brand-gold-400/70 dark:border-brand-gold-400/40")}
              >
                <CardContent className="space-y-3 p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                        isNew
                          ? "bg-brand-gold-100 text-brand-gold-900 dark:bg-brand-gold-400/15 dark:text-brand-gold-200"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {(lead.buyer_name || "?").trim().charAt(0).toUpperCase() || "?"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {lead.buyer_name || "A buyer"}
                        </p>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            STATUS_TONES[lead.status] ?? STATUS_TONES.read
                          )}
                        >
                          {humanStatus(lead.status)}
                        </span>
                        <span
                          className="ml-auto whitespace-nowrap text-xs text-muted-foreground"
                          suppressHydrationWarning
                        >
                          {formatRelativeTime(lead.created_at)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        Re: {lead.listings?.title || "Listing"}
                      </p>
                    </div>
                  </div>
                  {lead.message && (
                    <p className="whitespace-pre-wrap break-words rounded-xl bg-muted/60 px-3.5 py-3 text-sm text-foreground/90">
                      {lead.message}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {whatsappHref && (
                      <Button asChild variant="trust-verified" size="sm" className="h-11 px-4">
                        <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                          Reply on WhatsApp
                        </a>
                      </Button>
                    )}
                    {lead.buyer_email && (
                      <Button asChild variant="outline" size="sm" className="h-11 px-4">
                        <a
                          href={`mailto:${encodeURIComponent(lead.buyer_email)}?subject=${encodeURIComponent(`Re: ${lead.listings?.title || "Your enquiry"}`)}`}
                        >
                          Reply by email
                        </a>
                      </Button>
                    )}
                    <div
                      className="flex flex-wrap gap-1 sm:ml-auto"
                      role="group"
                      aria-label={`Update status for ${title}`}
                    >
                      {lead.status === "new" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-11 px-3"
                          onClick={() => {
                            void updateLeadStatus(lead.id, "read");
                          }}
                        >
                          Mark as read
                        </Button>
                      )}

                      {lead.status !== "contacted" && lead.status !== "closed" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-11 px-3"
                          onClick={() => {
                            void updateLeadStatus(lead.id, "contacted");
                          }}
                        >
                          Mark contacted
                        </Button>
                      )}

                      {lead.status !== "closed" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-11 px-3 text-muted-foreground"
                          onClick={() => {
                            void updateLeadStatus(lead.id, "closed");
                          }}
                        >
                          Close lead
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
