"use client";

import { useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils/format";
import { useRealtime } from "@/hooks/use-realtime";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { createClient } from "@/lib/supabase/client";

export interface LeadRow {
  id: string;
  target_id: string;
  target_type: string;
  message: string;
  status: string;
  buyer_name: string | null;
  buyer_email: string | null;
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
  return status;
}

export function LeadsFeed({ initialLeads, ownerColumn, ownerId }: LeadsFeedProps) {
  const [leads, setLeads] = useState<LeadRow[]>(initialLeads);
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

    const response = await fetch("/api/leads", {
      method: "PATCH",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: leadId, status: nextStatus }),
    });

    if (!response.ok) {
      setLeads((prev) =>
        prev.map((lead) => (lead.id === leadId ? { ...lead, status: previousLead.status } : lead))
      );
    }
  }

  if (!leads.length) {
    return (
      <div className="text-center py-6 space-y-3">
        <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="text-lg font-medium">No leads yet</p>
        <p className="text-sm text-muted-foreground">
          Leads will appear here when buyers contact you about a listing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {leads.map((lead) => (
        <Card key={lead.id}>
          <CardContent className="py-4 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  Re: {lead.listings?.title || "Listing"}
                </p>
                <Badge variant="outline" className="text-xs mt-1">
                  {humanStatus(lead.status)}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatRelativeTime(lead.created_at)}
              </span>
            </div>
            {lead.message && (
              <p className="text-sm text-muted-foreground line-clamp-3">{lead.message}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {lead.status === "new" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
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
                  variant="outline"
                  size="sm"
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
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void updateLeadStatus(lead.id, "closed");
                  }}
                >
                  Close lead
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
