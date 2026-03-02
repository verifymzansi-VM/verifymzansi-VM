"use client";

import { useState } from "react";
import { formatRelativeTime } from "@/lib/utils/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SlaBadge } from "./sla-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Shield, EyeOff, Ban, XCircle, Flag, Loader2 } from "lucide-react";
import { calculateSlaState, slaSortPriority } from "@/lib/utils/sla";
import type { ReportSeverity } from "@/types/enums";

interface ReportItem {
  id: string;
  target_id: string;
  target_type: string;
  category: string;
  severity: ReportSeverity;
  status: string;
  description?: string;
  reporter_user_id?: string | null;
  created_at: string;
}

interface FlaggingQueueTableProps {
  reports: ReportItem[];
  onActionComplete?: () => void;
}

const SEVERITY_FILTER = ["all", "high", "standard"] as const;

const ENFORCEMENT_ACTIONS = [
  { value: "warn", label: "Warn Seller", icon: AlertTriangle, variant: "default" as const },
  { value: "hide", label: "Hide Content", icon: EyeOff, variant: "default" as const },
  { value: "suspend", label: "Suspend Account", icon: Shield, variant: "destructive" as const },
  { value: "ban", label: "Ban Account", icon: Ban, variant: "destructive" as const },
  { value: "dismiss", label: "Dismiss Report", icon: XCircle, variant: "secondary" as const },
];

const SUSPEND_DURATIONS = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

export function FlaggingQueueTable({ reports, onActionComplete }: FlaggingQueueTableProps) {
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [selectedReport, setSelectedReport] = useState<ReportItem | null>(null);
  const [action, setAction] = useState("");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Filter and sort reports
  const filtered = reports
    .filter((r) => severityFilter === "all" || r.severity === severityFilter)
    .map((r) => ({
      ...r,
      sla: calculateSlaState(r.created_at, r.severity),
    }))
    .sort((a, b) => slaSortPriority(a.sla.state) - slaSortPriority(b.sla.state));

  function openAction(report: ReportItem) {
    setSelectedReport(report);
    setAction("");
    setReason("");
    setDuration(7);
    setError("");
  }

  function closeDialog() {
    setSelectedReport(null);
    setAction("");
    setReason("");
    setError("");
  }

  async function submitAction() {
    if (!selectedReport || !action) {
      setError("Please select an action.");
      return;
    }
    if (action === "dismiss" && !reason.trim()) {
      setError("Dismissal requires a reason.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/flagging/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId: selectedReport.id,
          action,
          reason: reason || undefined,
          durationDays: action === "suspend" ? duration : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit action");
      }

      closeDialog();
      onActionComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  if (!reports.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Flag className="h-10 w-10 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No open reports for this area.</p>
      </div>
    );
  }

  return (
    <>
      {/* Severity Filter */}
      <div className="flex gap-2 mb-4">
        {SEVERITY_FILTER.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={severityFilter === s ? "default" : "outline"}
            className="text-xs capitalize"
            onClick={() => setSeverityFilter(s)}
          >
            {s === "all" ? "All" : s}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((report) => (
          <Card
            key={report.id}
            className={
              report.sla.state === "breached"
                ? "border-destructive/50 bg-destructive/5"
                : report.sla.state === "at-risk"
                  ? "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20"
                  : ""
            }
          >
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={report.severity === "high" ? "destructive" : "secondary"}
                      className="text-[10px]"
                    >
                      {report.severity}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {report.category.replace(/_/g, " ")}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {report.target_type}
                    </Badge>
                    <SlaBadge state={report.sla.state} hoursRemaining={report.sla.hoursRemaining} />
                  </div>
                  {report.description && (
                    <p className="text-sm mt-1 line-clamp-2">{report.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Report #{report.id.slice(0, 8)} &middot; {formatRelativeTime(report.created_at)}{" "}
                    &middot; SLA:{" "}
                    {report.sla.hoursRemaining > 0
                      ? `${Math.floor(report.sla.hoursRemaining)}h remaining`
                      : "Breached"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-shrink-0"
                  onClick={() => openAction(report)}
                >
                  Take Action
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Enforcement Action Dialog */}
      <Dialog open={!!selectedReport} onOpenChange={(open: boolean) => !open && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enforcement Action</DialogTitle>
            <DialogDescription>
              Report #{selectedReport?.id.slice(0, 8)} &middot;{" "}
              {selectedReport?.category.replace(/_/g, " ")} &middot; {selectedReport?.severity}{" "}
              severity
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Action Selection */}
            <div>
              <Label className="text-sm font-medium">Action</Label>
              <div className="grid grid-cols-1 gap-2 mt-2">
                {ENFORCEMENT_ACTIONS.map((ea) => {
                  const Icon = ea.icon;
                  return (
                    <button
                      key={ea.value}
                      onClick={() => setAction(ea.value)}
                      className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors text-left ${
                        action === ea.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      <span>{ea.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Suspend Duration */}
            {action === "suspend" && (
              <div>
                <Label className="text-sm font-medium">Duration</Label>
                <select
                  title="Suspension duration"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {SUSPEND_DURATIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Reason */}
            <div>
              <Label className="text-sm font-medium">
                Reason {action === "dismiss" && <span className="text-destructive">*</span>}
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for this enforcement action..."
                rows={3}
                className="mt-1.5"
              />
            </div>

            {/* Ban Confirmation */}
            {action === "ban" && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3">
                <p className="text-sm text-destructive font-medium">
                  Warning: This will permanently ban the seller account and hide all their content.
                  This action cannot be easily reversed.
                </p>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={submitAction}
              disabled={loading || !action}
              variant={action === "ban" || action === "suspend" ? "destructive" : "default"}
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm Action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
