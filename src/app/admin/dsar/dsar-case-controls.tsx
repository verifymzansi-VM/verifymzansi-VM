"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CalendarPlus, Download, Loader2, UserCheck, UserMinus } from "lucide-react";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";

interface DsarCaseControlsProps {
  requestId: string;
  viewerId: string;
  assignedTo: string | null;
  identityVerified: boolean;
  /** The rules allow an extension, none was given, and the deadline has not passed. */
  canExtend: boolean;
  extensionDays: number;
  isOpen: boolean;
}

type ErrorBody = { error?: string; code?: string; verifyUrl?: string };

function filenameFrom(disposition: string | null, fallback: string): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

/**
 * Export, extend and assignment controls for one data request. The export
 * is a POST that needs a recent second factor; the file is handed straight
 * to the browser and never stored.
 */
export function DsarCaseControls({
  requestId,
  viewerId,
  assignedTo,
  identityVerified,
  canExtend,
  extensionDays,
  isOpen,
}: DsarCaseControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [working, setWorking] = useState<"export" | "extend" | "assign" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extendOpen, setExtendOpen] = useState(false);
  const [reason, setReason] = useState("");
  const busy = isPending || working !== null;

  /** Handles the shared failure cases; returns true when the caller should stop. */
  async function failed(res: Response): Promise<boolean> {
    if (res.ok) return false;
    const data = (await res.json().catch(() => ({}))) as ErrorBody;
    if ((data.code === "step_up_required" || data.code === "mfa_required") && data.verifyUrl) {
      router.push(staffVerifyHref(data.verifyUrl, "/admin/dsar"));
      return true;
    }
    setError(data.error || `Failed (${res.status})`);
    return true;
  }

  async function post(url: string, body: unknown) {
    return fetch(url, {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
  }

  async function handleExport() {
    setError(null);
    setWorking("export");
    try {
      const res = await post("/api/admin/dsar/export", { requestId });
      if (await failed(res)) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFrom(
        res.headers.get("Content-Disposition"),
        `dsar-export-${requestId.slice(0, 8)}.json`
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("The export failed. Try again.");
    } finally {
      setWorking(null);
    }
  }

  async function handleAssign(assigneeId: string | null) {
    setError(null);
    setWorking("assign");
    try {
      const res = await post("/api/admin/dsar/case", { action: "assign", requestId, assigneeId });
      if (await failed(res)) return;
      startTransition(() => router.refresh());
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setWorking(null);
    }
  }

  async function handleExtend() {
    setError(null);
    setWorking("extend");
    try {
      const res = await post("/api/admin/dsar/case", {
        action: "extend",
        requestId,
        reason: reason.trim(),
      });
      if (await failed(res)) return;
      setExtendOpen(false);
      setReason("");
      startTransition(() => router.refresh());
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {isOpen &&
          (assignedTo === viewerId ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => handleAssign(null)}>
              <UserMinus className="h-4 w-4 mr-1" />
              Unassign
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => handleAssign(viewerId)}
            >
              <UserCheck className="h-4 w-4 mr-1" />
              {assignedTo ? "Take over" : "Assign to me"}
            </Button>
          ))}
        {isOpen && canExtend && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setError(null);
              setExtendOpen(true);
            }}
          >
            <CalendarPlus className="h-4 w-4 mr-1" />
            Extend
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={busy || !identityVerified}
          title={identityVerified ? undefined : "Verify the requester's identity first"}
          onClick={handleExport}
        >
          {working === "export" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          <span>Export JSON</span>
        </Button>
      </div>
      {error && !extendOpen && (
        <p role="alert" className="text-xs text-destructive max-w-[220px] text-right">
          {error}
        </p>
      )}

      <Dialog
        open={extendOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setExtendOpen(open);
          if (!open) {
            setError(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend the deadline</DialogTitle>
            <DialogDescription>
              This moves the deadline by {extensionDays} days. It can be done once, before the
              deadline passes. The requester is emailed the new date and your reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`dsar-extend-reason-${requestId}`}>
              Reason (sent to the requester)
            </Label>
            <Textarea
              id={`dsar-extend-reason-${requestId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              minLength={10}
              maxLength={1000}
              disabled={busy}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setExtendOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || reason.trim().length < 10} onClick={handleExtend}>
              {working === "extend" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Extend and notify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
